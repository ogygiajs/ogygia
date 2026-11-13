import { next_any_tag, tag_name, type FoundTag } from '@ogygia/core/contract';
import { OgygiaError } from '../messages.ts';

const WS_RE = /\s/;
const TEMPLATE_INTERPOLATION_RE = /\$\{/;
const WORD_START_RE = /[A-Za-z_$]|[^\s\p{ASCII}]/u;
const WORD_RE = /[A-Za-z0-9_$]|[^\s\p{ASCII}]/u;
const NUMBER_RE = /[0-9A-Za-z_.]/;
const DIGIT_RE = /[0-9]/;

type Leaves = 'value' | 'operand' | 'head';

function word_leaves(word: string): Leaves {
	switch (word) {
		case 'if':
		case 'while':
		case 'for':
		case 'with':
			return 'head';
		case 'return':
		case 'typeof':
		case 'instanceof':
		case 'in':
		case 'of':
		case 'new':
		case 'delete':
		case 'void':
		case 'throw':
		case 'case':
		case 'do':
		case 'else':
		case 'yield':
		case 'await':
			return 'operand';
		default:
			return 'value';
	}
}

type Met = { at: number; kind: 'word'; end: number } | { at: number; kind: 'open' | 'close' };
const STOP = -1;
type Visit = (met: Met) => number | void;

function walk(src: string, from: number, visit: Visit): void {
	const stack: Array<{ c: string; regex_after: boolean }> = [];
	let value_before = false;
	let head = false;
	let dot_before = false;
	const n = src.length;
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
			while (j < n && WORD_RE.test(src[j]!)) j++;
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
			const leaves = property || number ? 'value' : word_leaves(word);
			if (!(head && word === 'await')) head = leaves === 'head';
			value_before = leaves !== 'operand';
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
		if ((c === '+' || c === '-') && c2 === c) {
			i++;
			if (value_before) continue;
		}
		value_before = false;
		if (c === '.' && c2 === '.' && src[i + 1] === '.') {
			i += 2;
			dot_before = false;
		} else dot_before = c === '.';
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
	if (q === '`' && TEMPLATE_INTERPOLATION_RE.test(value)) {
		throw new OgygiaError('call_arg_interpolated', { call: who });
	}
	let k = j + 1;
	while (k < args.length && WS_RE.test(args[k]!)) k++;
	if (k < args.length && args[k] !== ',') {
		throw new OgygiaError('call_arg_in_expression', { call: who, near: args.slice(i, k + 8) });
	}
	if (args[k] === ',') k++;
	return { value, rest: args.slice(k).trim() };
}

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
	if (is_markup_module(id, markup_exts))
		return component_blocks(src)
			.filter((b) => b.kind === 'script')
			.map((b) => ({ code: src.slice(b.start, b.end), offset: b.start }));
	return null;
}

/** A `<script>` or `<style>` block of a component's source. */
export interface ComponentBlock {
	readonly kind: 'script' | 'style';
	/** `<script module>` (or Svelte 4's `context="module"`) */
	readonly module: boolean;
	/** its `lang` (lower case), or null */
	readonly lang: string | null;
	/** the opening tag: its `<` and just past its `>` */
	readonly open: number;
	/** its content: from just past the opening tag to the `</` of its end tag */
	readonly start: number;
	readonly end: number;
	/** just past the end tag's `>` */
	readonly close: number;
	/** the opening tag as the walk read it (core's `attr_spans` cuts an attribute out of it) */
	readonly tag: FoundTag;
}

/**
 * Every `<script>` and `<style>` block of a component's source, in order, read with core's tag walk
 * (#1370): a value may hold `>` or the other quote, any quoting and case, a comment holds no block,
 * and a block's text holds no tag (`<style>` inside a script's string is text). A block whose end
 * tag never comes is not one (the source ends inside it). test/component-blocks.test.ts.
 */
export function component_blocks(src: string): ComponentBlock[] {
	const blocks: ComponentBlock[] = [];
	for (let tag = next_any_tag(src, 0); tag !== null; tag = next_any_tag(src, tag.next)) {
		const kind = tag_name(src, tag);
		if (kind !== 'script' && kind !== 'style') continue;
		if (tag.next >= src.length) break;
		const gt = src.indexOf('>', tag.next);
		const lang = tag.attr('lang');
		blocks.push({
			kind,
			module:
				kind === 'script' && (tag.attr('module') !== undefined || tag.attr('context') === 'module'),
			lang: lang ? lang.toLowerCase() : null,
			open: tag.start,
			start: tag.end,
			end: tag.next,
			close: gt === -1 ? src.length : gt + 1,
			tag
		});
	}
	return blocks;
}
