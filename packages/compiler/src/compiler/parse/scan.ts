/**
 * The string-aware macro SCANNER — the cheap-bailout front-end for `import.meta.og.*`.
 *
 * Two jobs, no full parse:
 *   • the LEXER (`find_og_calls` / `match_close` / `split_first_string`) locates
 *     `import.meta.og.<path>(…)` CALLS in a module's source with a single left-to-right pass that
 *     skips strings, comments, and regex literals, so a marker inside a doc comment or a string is
 *     never mistaken for a call.
 *   • the EXTRACTOR (`og_js_regions` / `is_js_module` / `is_markup_module`) decides where those
 *     constructs are recognized per file type, and yields the JS slices to analyze.
 *
 * Why not an AST? These rewrites run in the Vite `transform` hook on EVERY module (svelte/ts/js) —
 * a parse per module per construct is the tax we refuse. The scanner is O(n), allocation-light, and
 * (critically) survives partial/invalid syntax mid-edit in dev. The git loader proved it; this is
 * that scanner, generalized so all constructs share one code path.
 */
import { OgygiaError } from '../messages.ts';

// ── regexes
const WS_RE = /\s/;
const TEMPLATE_INTERPOLATION_RE = /\$\{/;
const WORD_START_RE = /[A-Za-z_$]/;
const WORD_RE = /[A-Za-z0-9_$]/;
const NUMBER_RE = /[0-9A-Za-z_.]/;
const DIGIT_RE = /[0-9]/;

// ─────────────────────────────────────────────────────────────────────────────
// LEXER — one hand-rolled walk shared by every compile construct.
// ─────────────────────────────────────────────────────────────────────────────

/** Words after which a value is expected, so a `/` opens a regular expression. */
const VALUE_AFTER_WORD = new Set([
	'return',
	'typeof',
	'instanceof',
	'in',
	'of',
	'new',
	'delete',
	'void',
	'throw',
	'case',
	'do',
	'else',
	'yield',
	'await'
]);
/** Statement heads: after their `( … )` a statement starts, so a `/` there opens a regex. */
const STATEMENT_HEADS = new Set(['if', 'while', 'for', 'with']);

/** What the walk met in code: a word (`end` is past it), or a bracket. */
type Met = { at: number; kind: 'word'; end: number } | { at: number; kind: 'open' | 'close' };
/** A visitor's answer: go on (nothing), stop the walk, or the index past a value it took. */
const STOP = -1;
type Visit = (met: Met) => number | void;

/**
 * Walk the JS in `src` from `from`, calling `visit` at each word and each bracket in CODE: never
 * inside a string, a comment, a regex literal or a template's text (a template's `${…}` is code
 * again, at any depth). A `/` divides or opens a regex as a parser decides it, by what came before:
 * a value (a name, a literal, a `)`, a `]`, a postfix `++`) divides; an operator, an opener, a
 * keyword that wants a value, a statement head's `)` or a block's `}` opens a regex. Unterminated
 * input (an edit in progress) runs to the end; it never throws. (test/scan-differential.test.ts
 * holds it to oxc.)
 */
function walk(src: string, from: number, visit: Visit): void {
	// each open bracket (`${` for a template's), and whether a `/` after its close opens a regex
	const stack: Array<{ c: string; regex_after: boolean }> = [];
	let value_before = false;
	let head = false; // the last word was a statement head
	let dot_before = false; // the next word is a property name
	const n = src.length;
	/** Through template text from `at`: past the closing backtick, or into a `${`. */
	const template = (at: number): number => {
		for (let j = at; j < n; j++) {
			const c = src[j]!;
			if (c === '\\') j++;
			else if (c === '`') {
				value_before = true;
				return j + 1;
			} else if (c === '$' && src[j + 1] === '{') {
				stack.push({ c: '${', regex_after: false });
				value_before = false;
				return j + 2;
			}
		}
		return n;
	};
	let i = from;
	while (i < n) {
		const c = src[i]!;
		const c2 = src[i + 1];
		if (c === "'" || c === '"') {
			let j = i + 1;
			for (; j < n; j++) {
				if (src[j] === '\\') j++;
				else if (src[j] === c || src[j] === '\n') break;
			}
			i = j + 1;
			value_before = true;
			dot_before = head = false;
			continue;
		}
		if (c === '`') {
			i = template(i + 1);
			dot_before = head = false;
			continue;
		}
		if (c === '/' && c2 === '/') {
			const nl = src.indexOf('\n', i + 2);
			i = nl < 0 ? n : nl + 1;
			continue;
		}
		if (c === '/' && c2 === '*') {
			const end = src.indexOf('*/', i + 2);
			i = end < 0 ? n : end + 2;
			continue;
		}
		if (c === '/' && !value_before) {
			let j = i + 1;
			let in_class = false;
			for (; j < n; j++) {
				const r = src[j]!;
				if (r === '\\') j++;
				else if (r === '\n') break;
				else if (r === '[') in_class = true;
				else if (r === ']') in_class = false;
				else if (r === '/' && !in_class) break;
			}
			j++;
			while (j < n && WORD_RE.test(src[j]!)) j++; // its flags
			i = j;
			value_before = true;
			dot_before = head = false;
			continue;
		}
		if (WORD_START_RE.test(c) || DIGIT_RE.test(c)) {
			const number = DIGIT_RE.test(c);
			let j = i + 1;
			while (j < n && (number ? NUMBER_RE : WORD_RE).test(src[j]!)) j++;
			const word = src.slice(i, j);
			const property = dot_before;
			const resume = number || property ? undefined : visit({ at: i, kind: 'word', end: j });
			if (resume === STOP) return;
			if (typeof resume === 'number') {
				i = resume;
				value_before = true;
				dot_before = head = false;
				continue;
			}
			i = j;
			// (`for await (…)` keeps its head)
			if (!(head && word === 'await')) head = !property && STATEMENT_HEADS.has(word);
			value_before = property || number || !VALUE_AFTER_WORD.has(word);
			dot_before = false;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			stack.push({ c, regex_after: c === '{' || (c === '(' && head) });
			if (visit({ at: i, kind: 'open' }) === STOP) return;
			i++;
			value_before = dot_before = head = false;
			continue;
		}
		if (c === ')' || c === ']' || c === '}') {
			const top = stack.pop();
			if (c === '}' && top?.c === '${') {
				i = template(i + 1);
				dot_before = head = false;
				continue;
			}
			if (visit({ at: i, kind: 'close' }) === STOP) return;
			i++;
			value_before = !(top?.regex_after ?? false);
			dot_before = head = false;
			continue;
		}
		i++;
		if (WS_RE.test(c)) continue;
		// a postfix `++`/`--` leaves a value (`i++ / 2` divides); a prefix one wants one
		if ((c === '+' || c === '-') && c2 === c) {
			i++;
			if (value_before) continue;
		}
		value_before = false;
		dot_before = c === '.';
		head = false;
	}
}

/** Index of the `)` matching the `(` at `open`, skipping strings, comments, regex literals (incl.
 *  `[…]` char classes, which may hold an unescaped `/`) and template text. -1 if unbalanced. */
export function match_close(src: string, open: number): number {
	let depth = 0;
	let found = -1;
	walk(src, open, (met) => {
		if (met.kind === 'open') depth++;
		else if (met.kind === 'close' && --depth === 0) {
			found = met.at;
			return STOP;
		}
	});
	return found;
}

/** One located `import.meta.og.<method>(<args>)` call. `args` is the VERBATIM text between the
 *  parens; `method` is the dotted tail after the shared prefix (`loader.git`, `code`, `regions`). */
export type OgCall = { start: number; end: number; method: string; args: string };

const IDENT = /[A-Za-z0-9_$.]/;

/**
 * Find every `<prefix><method>(…)` call in `src`. `prefix` is the literal namespace head
 * (`import.meta.og.`, a word's start); `method` is the dotted identifier chain that follows, up to
 * the `(`. Only in code (a template's `${…}` included), so a marker in prose is never a hit. Pure.
 */
export function find_og_calls(src: string, prefix: string): OgCall[] {
	const calls: OgCall[] = [];
	walk(src, 0, (met) => {
		if (met.kind !== 'word' || !src.startsWith(prefix, met.at)) return;
		let p = met.at + prefix.length;
		const name_start = p;
		while (p < src.length && IDENT.test(src[p]!)) p++;
		const method = src.slice(name_start, p);
		let q = p;
		while (q < src.length && WS_RE.test(src[q]!)) q++;
		const close = method && src[q] === '(' ? match_close(src, q) : -1;
		if (close < 0) return p;
		calls.push({ start: met.at, end: close + 1, method, args: src.slice(q + 1, close) });
		return close + 1;
	});
	return calls;
}

/** Split a call's argument text into the first string-literal (unquoted) and the verbatim rest.
 *  Throws (with `who` in the message) when the first argument is not a STATIC string literal — a
 *  bare identifier, or a template literal with `${…}` interpolation (not build-determinable). */
export function split_first_string(args: string, who: string): { value: string; rest: string } {
	let i = 0;
	while (i < args.length && WS_RE.test(args[i]!)) i++;
	const q = args[i];
	if (q !== "'" && q !== '"' && q !== '`') {
		throw new OgygiaError('call_arg_not_literal', { call: who, got: args.slice(0, 24) });
	}
	let j = i + 1;
	for (; j < args.length; j++) {
		if (args[j] === '\\') j++;
		else if (args[j] === q) break;
	}
	const value = args.slice(i + 1, j);
	// A template literal with interpolation is a runtime value, not a build-time literal.
	if (q === '`' && TEMPLATE_INTERPOLATION_RE.test(value)) {
		throw new OgygiaError('call_arg_interpolated', { call: who });
	}
	let k = j + 1;
	while (k < args.length && WS_RE.test(args[k]!)) k++;
	// After the closing quote the ONLY things that may follow are `,` (the next argument) or the end.
	// Anything else means the string is part of a larger expression (`"./" + dir`, a tagged template,
	// a `.concat(…)` call) — a runtime value the build can't resolve. Fail loudly, don't mis-slice.
	if (k < args.length && args[k] !== ',') {
		throw new OgygiaError('call_arg_in_expression', { call: who, near: args.slice(i, k + 8) });
	}
	if (args[k] === ',') k++;
	return { value, rest: args.slice(k).trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR — where constructs are recognized, and how each file type yields the JS to analyze.
//
// OWNERSHIP. At the Vite-transform layer this handles exactly two shapes — `.svelte` components and
// JS/TS modules (`.ts`/`.js`/`.mjs`, which covers `.svelte.ts`/`.svelte.js`). Content files
// (`.svx`/`.md`) are NOT here: they route through the markdown preprocessor (mdsvex → svelte), which
// owns them — a construct inside a content file is the preprocessor's job, and it can reuse this same
// extractor. The host set is still passed in (config-driven), so the one caller that owns markup can
// decide which markup extensions count; the plugin passes `['.svelte']`.
//
// Per type the parse strategy differs — so detection stays AST-precise everywhere:
//   • JS/TS module  → the WHOLE file is one JS region (offset 0).
//   • `.svelte`     → each `<script>` / `<script module>` block is a JS region at its byte offset.
// A construct in markup PROSE (not a `<script>`) is never a JS region — that's content, not code.
// ─────────────────────────────────────────────────────────────────────────────

/** A slice of JS/TS to analyze, plus where it starts in the original source (for offset mapping). */
export type JsRegion = { code: string; offset: number };

const JS_EXT = /\.(ts|js|mjs|cjs|mts|cts)$/;

/** Does `id` (a module path, maybe with a `?query`) end in a plain JS/TS extension? */
export function is_js_module(id: string): boolean {
	const clean = id.split('?')[0]!;
	return JS_EXT.test(clean);
}

/** Does `id` end in one of the configured MARKUP extensions (`.svelte`, `.svx`, `.md`)? */
export function is_markup_module(id: string, markup_exts: readonly string[]): boolean {
	const clean = id.split('?')[0]!;
	return markup_exts.some((ext) => clean.endsWith(ext));
}

/**
 * Extract the JS regions of a module for construct analysis. Returns `null` when the extension is not
 * a recognized construct host (the caller then leaves the file untouched). A JS/TS module is one
 * region; a markup file is its `<script>` blocks. `.svelte.ts`/`.svelte.js` hit the JS branch first
 * (they end in `.ts`/`.js`), so a `.svelte`-suffixed markup ext never shadows them.
 */
export function og_js_regions(
	src: string,
	id: string,
	markup_exts: readonly string[]
): JsRegion[] | null {
	if (is_js_module(id)) return [{ code: src, offset: 0 }];
	if (is_markup_module(id, markup_exts)) return script_blocks(src);
	return null;
}

/**
 * Find every `<script …>…</script>` block and return its inner JS + byte offset. A single forward
 * scan (not a regex) so a `</script>` inside a JS string can't end a block early: we only close on a
 * `</script>` found while scanning raw text, and Svelte itself forbids an unescaped `</script>` in
 * script text, so this matches the compiler's own tokenization.
 */
function script_blocks(src: string): JsRegion[] {
	const regions: JsRegion[] = [];
	const lower = src.toLowerCase();
	let i = 0;
	for (;;) {
		const open = lower.indexOf('<script', i);
		if (open < 0) break;
		// End of the opening tag — the `>` that closes `<script …>`. Skip `>` inside attribute strings.
		const gt = tag_end(src, open);
		if (gt < 0) break;
		const close = lower.indexOf('</script>', gt + 1);
		if (close < 0) break;
		regions.push({ code: src.slice(gt + 1, close), offset: gt + 1 });
		i = close + '</script>'.length;
	}
	return regions;
}

/** Index of the `>` that ends the tag opened at `open`, honoring quoted attribute values. */
function tag_end(src: string, open: number): number {
	for (let i = open; i < src.length; i++) {
		const c = src[i]!;
		if (c === '"' || c === "'") {
			for (i++; i < src.length && src[i] !== c; i++) {}
			continue;
		}
		if (c === '>') return i;
	}
	return -1;
}
