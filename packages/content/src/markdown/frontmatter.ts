import { OgygiaError } from '../messages/build.ts';

const HEX4_RE = /^[0-9a-fA-F]{4}$/;
const YAML_INF_RE = /^[-+]?\.(inf|Inf|INF)$/;
const YAML_NAN_RE = /^\.(nan|NaN|NAN)$/;
const YAML_HEX_RE = /^[-+]?0x[0-9a-fA-F]+$/;
const SIGN_RE = /^[-+]/;
const YAML_OCTAL_RE = /^[-+]?0o[0-7]+$/;
const SIGN_OCTAL_PREFIX_RE = /^[-+]?0o/;
const YAML_INT_RE = /^[-+]?[0-9]+$/;
const YAML_FLOAT_RE = /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*|[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
const FLOAT_MARK_RE = /[.eE]/;
const CHOMP_THEN_INDENT_RE = /^[+-]?[0-9]*$/;
const INDENT_THEN_CHOMP_RE = /^[0-9]*[+-]?$/;
const LEADING_SPACES_RE = /^ */;
const CRLF_G = /\r\n?/g;

type Ctx = { lines: string[]; i: number };
type Cursor = { s: string; i: number };

function indent_of(line: string): number {
	let i = 0;
	while (i < line.length && line[i] === ' ') i++;
	if (line[i] === '\t') {
		throw new OgygiaError('content_frontmatter_tab_indent');
	}
	return i;
}

function leading_spaces(line: string): number {
	let i = 0;
	while (i < line.length && line[i] === ' ') i++;
	return i;
}

function is_skippable(line: string): boolean {
	const t = line.trim();
	return t === '' || t[0] === '#';
}

function skip_blank_comments(ctx: Ctx): void {
	while (ctx.i < ctx.lines.length && is_skippable(ctx.lines[ctx.i])) ctx.i++;
}

function is_seq_item(content: string): boolean {
	return content === '-' || content.startsWith('- ') || content.startsWith('-\t');
}

function find_key_colon(s: string): number {
	let in_s = false;
	let in_d = false;
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (in_s) {
			if (c === "'") {
				if (s[i + 1] === "'") i++;
				else in_s = false;
			}
			continue;
		}
		if (in_d) {
			if (c === '\\') i++;
			else if (c === '"') in_d = false;
			continue;
		}
		if (c === '"') in_d = true;
		else if (c === "'") in_s = true;
		else if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') depth--;
		else if (c === ':' && depth === 0) {
			const n = s[i + 1];
			if (n === undefined || n === ' ' || n === '\t') return i;
		}
	}
	return -1;
}

function strip_comment(s: string): string {
	let in_s = false;
	let in_d = false;
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (in_s) {
			if (c === "'") {
				if (s[i + 1] === "'") i++;
				else in_s = false;
			}
			continue;
		}
		if (in_d) {
			if (c === '\\') i++;
			else if (c === '"') in_d = false;
			continue;
		}
		if (c === '"') in_d = true;
		else if (c === "'") in_s = true;
		else if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') depth--;
		else if (c === '#' && depth === 0 && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
			return s.slice(0, i);
		}
	}
	return s;
}

function read_double_quoted(s: string, i: number): { value: string; i: number } {
	i++;
	let out = '';
	while (i < s.length) {
		const c = s[i];
		if (c === '\\') {
			const n = s[i + 1];
			switch (n) {
				case 'n':
					out = `${out}\n`;
					break;
				case 't':
					out = `${out}\t`;
					break;
				case 'r':
					out = `${out}\r`;
					break;
				case '0':
					out = `${out}\0`;
					break;
				case 'b':
					out = `${out}\b`;
					break;
				case 'f':
					out = `${out}\f`;
					break;
				case '"':
					out = `${out}"`;
					break;
				case '\\':
					out = `${out}\\`;
					break;
				case '/':
					out = `${out}/`;
					break;
				case 'u': {
					const hex = s.slice(i + 2, i + 6);
					if (HEX4_RE.test(hex)) {
						out += String.fromCharCode(parseInt(hex, 16));
						i += 6;
						continue;
					}
					out = `${out}u`;
					break;
				}
				default:
					out += n ?? '';
			}
			i += 2;
			continue;
		}
		if (c === '"') return { value: out, i: i + 1 };
		out += c;
		i++;
	}
	return { value: out, i };
}

function read_single_quoted(s: string, i: number): { value: string; i: number } {
	i++;
	let out = '';
	while (i < s.length) {
		const c = s[i];
		if (c === "'") {
			if (s[i + 1] === "'") {
				out = `${out}'`;
				i += 2;
				continue;
			}
			return { value: out, i: i + 1 };
		}
		out += c;
		i++;
	}
	return { value: out, i };
}

function parse_plain(text: string): unknown {
	if (text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
	if (text === 'true' || text === 'True' || text === 'TRUE') return true;
	if (text === 'false' || text === 'False' || text === 'FALSE') return false;

	if (YAML_INF_RE.test(text)) return text[0] === '-' ? -Infinity : Infinity;
	if (YAML_NAN_RE.test(text)) return NaN;

	if (YAML_HEX_RE.test(text)) {
		const neg = text[0] === '-';
		const n = Number(text.replace(SIGN_RE, ''));
		return neg ? -n : n;
	}
	if (YAML_OCTAL_RE.test(text)) {
		const neg = text[0] === '-';
		const n = parseInt(text.replace(SIGN_OCTAL_PREFIX_RE, ''), 8);
		return neg ? -n : n;
	}
	if (YAML_INT_RE.test(text)) return parseInt(text, 10);
	if (YAML_FLOAT_RE.test(text) && FLOAT_MARK_RE.test(text)) {
		return Number(text);
	}
	return text;
}

function skip_ws(p: Cursor): void {
	while (p.i < p.s.length && (p.s[p.i] === ' ' || p.s[p.i] === '\t')) p.i++;
}

function read_flow_plain(p: Cursor, is_key: boolean): string {
	const start = p.i;
	while (p.i < p.s.length) {
		const c = p.s[p.i];
		if (c === ',' || c === ']' || c === '}') break;
		if (is_key && c === ':') break;
		// @why YAML has no `[` or `{` inside a plain flow item (`[see [a, b]]` is an error there, not a list) (test: frontmatter-flow › a bracket or brace inside a plain item)
		if (c === '[' || c === '{')
			throw new OgygiaError('content_frontmatter_invalid', {
				reason: `a \`${c}\` inside a list or map item (\`${p.s.trim()}\`): quote the item, or the whole value`
			});
		p.i++;
	}
	return p.s.slice(start, p.i).trim();
}

function read_flow_node(p: Cursor): unknown {
	skip_ws(p);
	const c = p.s[p.i];
	if (c === '[') return read_flow_seq(p);
	if (c === '{') return read_flow_map(p);
	if (c === '"') {
		const r = read_double_quoted(p.s, p.i);
		p.i = r.i;
		return r.value;
	}
	if (c === "'") {
		const r = read_single_quoted(p.s, p.i);
		p.i = r.i;
		return r.value;
	}
	const raw = read_flow_plain(p, false);
	return raw === '' ? null : parse_plain(raw);
}

function read_flow_seq(p: Cursor): unknown[] {
	p.i++;
	const arr: unknown[] = [];
	skip_ws(p);
	if (p.s[p.i] === ']') {
		p.i++;
		return arr;
	}
	while (p.i < p.s.length) {
		arr.push(read_flow_node(p));
		skip_ws(p);
		const c = p.s[p.i];
		if (c === ',') {
			p.i++;
			skip_ws(p);
			if (p.s[p.i] === ']') {
				p.i++;
				return arr;
			}
			continue;
		}
		if (c === ']') {
			p.i++;
			return arr;
		}
		break;
	}
	return arr;
}

function read_flow_map(p: Cursor): Record<string, unknown> {
	p.i++;
	const obj: Record<string, unknown> = {};
	skip_ws(p);
	if (p.s[p.i] === '}') {
		p.i++;
		return obj;
	}
	while (p.i < p.s.length) {
		skip_ws(p);
		let key: string;
		const kc = p.s[p.i];
		if (kc === '"') {
			const r = read_double_quoted(p.s, p.i);
			p.i = r.i;
			key = r.value;
		} else if (kc === "'") {
			const r = read_single_quoted(p.s, p.i);
			p.i = r.i;
			key = r.value;
		} else {
			key = read_flow_plain(p, true);
		}
		skip_ws(p);
		if (p.s[p.i] === ':') p.i++;
		set_key(obj, key, read_flow_node(p));
		skip_ws(p);
		const c = p.s[p.i];
		if (c === ',') {
			p.i++;
			skip_ws(p);
			if (p.s[p.i] === '}') {
				p.i++;
				return obj;
			}
			continue;
		}
		if (c === '}') {
			p.i++;
			return obj;
		}
		break;
	}
	return obj;
}

function parse_flow(text: string): unknown {
	const p: Cursor = { s: text, i: 0 };
	return read_flow_node(p);
}

function is_flow_collection(text: string, open: '{' | '[', sep: ':' | ','): boolean {
	const close = open === '{' ? '}' : ']';
	if (text.slice(text.indexOf(open) + 1, text.lastIndexOf(close)).trim() === '') return true;
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"' || ch === "'") {
			const q = ch;
			for (i++; i < text.length && text[i] !== q; i++) if (text[i] === '\\') i++;
			continue;
		}
		if (ch === '{' || ch === '[') depth++;
		else if (ch === '}' || ch === ']') {
			depth--;
			if (depth === 0 && open === '[') return i === text.length - 1;
		} else if (ch === sep && depth === 1) return true;
	}
	return false;
}

function parse_scalar(text: string): unknown {
	if (text === '') return null;
	const c = text[0];
	if (c === '{') return is_flow_collection(text, '{', ':') ? parse_flow(text) : text;
	if (c === '[') return is_flow_collection(text, '[', ',') ? parse_flow(text) : text;
	if (c === '"') return read_double_quoted(text, 0).value;
	if (c === "'") return read_single_quoted(text, 0).value;
	return parse_plain(text);
}

function parse_key(raw: string): string {
	const t = raw.trim();
	if (t[0] === '"') return read_double_quoted(t, 0).value;
	if (t[0] === "'") return read_single_quoted(t, 0).value;
	return t;
}

function is_block_scalar_indicator(s: string): boolean {
	if (s[0] !== '|' && s[0] !== '>') return false;
	const rest = s.slice(1);
	return CHOMP_THEN_INDENT_RE.test(rest) || INDENT_THEN_CHOMP_RE.test(rest);
}

function parse_block_scalar(ctx: Ctx, parent_indent: number, header: string): string {
	const style = header[0];
	let chomp = '';
	let explicit = 0;
	for (const ch of header.slice(1)) {
		if (ch === '+' || ch === '-') chomp = ch;
		else if (ch >= '0' && ch <= '9') explicit = explicit * 10 + (ch.charCodeAt(0) - 48);
	}

	const collected: string[] = [];
	while (ctx.i < ctx.lines.length) {
		const l = ctx.lines[ctx.i];
		if (l.trim() === '') {
			collected.push('');
			ctx.i++;
			continue;
		}
		if (leading_spaces(l) <= parent_indent) break;
		collected.push(l);
		ctx.i++;
	}

	let content_indent: number;
	if (explicit > 0) {
		content_indent = parent_indent + explicit;
	} else {
		content_indent = Infinity;
		for (const l of collected) {
			if (l.trim() !== '') content_indent = Math.min(content_indent, leading_spaces(l));
		}
		if (content_indent === Infinity) content_indent = parent_indent + 1;
	}

	const stripped = collected.map((l) => (l.trim() === '' ? '' : l.slice(content_indent)));

	let end = stripped.length;
	while (end > 0 && stripped[end - 1] === '') end--;
	const body = stripped.slice(0, end);
	const trailing_blanks = stripped.length - end;

	let text: string;
	if (style === '|') {
		text = body.join('\n');
	} else {
		text = '';
		for (let k = 0; k < body.length; k++) {
			const cur = body[k];
			if (k === 0) text += cur;
			else if (cur === '') text = `${text}\n`;
			else if (body[k - 1] === '') text += cur;
			else text = `${text} ${cur}`;
		}
	}

	if (body.length === 0) return chomp === '+' ? '\n'.repeat(trailing_blanks) : '';
	if (chomp === '-') return text;
	if (chomp === '+') return text + '\n'.repeat(trailing_blanks + 1);
	return `${text}\n`;
}

function parse_child(ctx: Ctx, indent: number): unknown {
	const save = ctx.i;
	skip_blank_comments(ctx);
	if (ctx.i >= ctx.lines.length) {
		ctx.i = save;
		return null;
	}
	const line = ctx.lines[ctx.i];
	const col = indent_of(line);
	const content = line.slice(col);
	if (col > indent) return parse_block(ctx, col);
	if (col === indent && is_seq_item(content)) return parse_sequence(ctx, indent);
	ctx.i = save;
	return null;
}

function parse_sequence(ctx: Ctx, indent: number): unknown[] {
	const arr: unknown[] = [];
	while (true) {
		skip_blank_comments(ctx);
		if (ctx.i >= ctx.lines.length) break;
		const line = ctx.lines[ctx.i];
		const col = indent_of(line);
		if (col !== indent) break;
		const content = line.slice(col);
		if (!is_seq_item(content)) break;

		const rest = content.slice(1);
		if (rest.trim() === '') {
			ctx.i++;
			const save = ctx.i;
			skip_blank_comments(ctx);
			if (ctx.i < ctx.lines.length && indent_of(ctx.lines[ctx.i]) > col) {
				arr.push(parse_block(ctx, indent_of(ctx.lines[ctx.i])));
			} else {
				ctx.i = save;
				arr.push(null);
			}
		} else {
			const leading = rest.length - rest.replace(LEADING_SPACES_RE, '').length;
			const item_indent = col + 1 + leading;
			ctx.lines[ctx.i] = ' '.repeat(col + 1) + rest;
			arr.push(parse_block(ctx, item_indent));
		}
	}
	return arr;
}

function parse_mapping(ctx: Ctx, indent: number): Record<string, unknown> {
	const obj: Record<string, unknown> = {};
	while (true) {
		skip_blank_comments(ctx);
		if (ctx.i >= ctx.lines.length) break;
		const line = ctx.lines[ctx.i];
		const col = indent_of(line);
		if (col !== indent) break;
		const content = line.slice(col);
		if (is_seq_item(content)) break;
		const kc = find_key_colon(content);
		if (kc === -1) break;

		const key = parse_key(content.slice(0, kc));
		if (key === '') {
			throw new OgygiaError('content_frontmatter_empty_key', {
				line: JSON.stringify(line.trim())
			});
		}
		const value_part = content.slice(kc + 1);
		ctx.i++;
		const clean = strip_comment(value_part).trim();

		if (is_block_scalar_indicator(clean)) set_key(obj, key, parse_block_scalar(ctx, indent, clean));
		else set_key(obj, key, clean === '' ? parse_child(ctx, indent) : parse_scalar(clean));
	}
	return obj;
}

function set_key(obj: Record<string, unknown>, key: string, value: unknown): void {
	// @why a parsed key is the object's own, as JSON.parse makes it: `__proto__` never sets the prototype (test: test/frontmatter.test.ts › a `__proto__` key is a plain key)
	if (key === '__proto__')
		Object.defineProperty(obj, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
	else obj[key] = value;
}

function parse_block(ctx: Ctx, indent: number): unknown {
	skip_blank_comments(ctx);
	const line = ctx.lines[ctx.i];
	const col = indent_of(line);
	const content = line.slice(col);
	if (is_seq_item(content)) return parse_sequence(ctx, indent);
	if (find_key_colon(content) !== -1) return parse_mapping(ctx, indent);

	ctx.i++;
	const clean = strip_comment(content).trim();
	if (is_block_scalar_indicator(clean)) return parse_block_scalar(ctx, indent - 1, clean);
	return parse_scalar(clean);
}

/**
 * Parse a frontmatter block (the text between the `---` fences) into a plain value: almost always a
 * mapping, but a top-level sequence or scalar too. Empty or comment-only input gives `{}`, never
 * null. It has no dependencies, and both `parseFrontmatter` and the markdown preprocessor (mdsvex's
 * `frontmatter.parse`) read frontmatter through it.
 *
 * It is a frontmatter parser first and a YAML parser second. It reads:
 * - block mappings and sequences at any consistent indent (sequences of maps, `- - x`);
 * - plain, single-quoted (`''` is one quote) and double-quoted scalars (`\n \t \r \0 \" \\ \/ \b
 *   \f \uXXXX`), as values and as keys;
 * - typed plain scalars: integers, floats (sign, exponent, `.5`, `.inf`, `.nan`), hex `0x`, octal
 *   `0o`, `true`/`false` and `null`/`~` (lower, Title or UPPER case);
 * - one-line flow collections (`[a, b]`, `{ a: 1 }`, nested); a whole `[…]` value is a list, one
 *   item or many (`tags: [svelte]`);
 * - `#` comments after whitespace, outside quotes and flow collections (`a#b` stays text);
 * - block scalars `|` and `>`, with chomping and indent indicators (`|-`, `|+`, `>2`).
 *
 * Where it differs from the `yaml` package, on purpose:
 * - a `{…}` with no top-level `:` is the string it looks like (`title: {@const}`, as the Svelte
 *   docs title pages), and so is a value whose opening `[` closes before its end (`[docs](/docs)`,
 *   `[docs][ref]`);
 * - only `true`/`false` are booleans (`country: no` stays `'no'`);
 * - dates stay strings (a schema coerces them);
 * - anchors, aliases, tags and merge keys stay text, and nothing after an inner `---` is read.
 *
 * A tab indent or an empty key throws.
 */
export function parse_yaml(source: string): unknown {
	const normalized = source.replace(BOM, '').replace(CRLF_G, '\n');
	const ctx: Ctx = { lines: normalized.split('\n'), i: 0 };
	skip_blank_comments(ctx);
	if (ctx.i >= ctx.lines.length) return {};
	const base = indent_of(ctx.lines[ctx.i]);
	const result = parse_block(ctx, base);
	return result === undefined ? {} : result;
}

const BOM = /^\uFEFF/;
const LEADING_NEWLINE = /^\r?\n/;

export type FrontmatterResult = {
	data: Record<string, unknown>;
	body: string;
};

function reason_of(e: unknown): string {
	const message = e instanceof Error ? e.message : String(e);
	if (!(e instanceof OgygiaError)) return message;
	const link = message.lastIndexOf('\nhttps://ogygiajs.dev/e/');
	const words = link === -1 ? message : message.slice(0, link);
	return words.startsWith('[ogygia] ') ? words.slice('[ogygia] '.length) : words;
}

/**
 * Split a file into its `---` frontmatter data and its body. With no opening or no closing fence
 * there is no data and the whole text is the body. A list or scalar block gives no data; a block
 * `parse_yaml` refuses throws `content_frontmatter_invalid` with the reason.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
	const text = source.replace(BOM, '');
	if (!text.startsWith('---')) {
		return { data: {}, body: text };
	}
	const lineEnd = text.indexOf('\n');
	if (lineEnd === -1) return { data: {}, body: text };
	const close = text.indexOf('\n---', lineEnd);
	if (close === -1) return { data: {}, body: text };
	const yamlBlock = text.slice(lineEnd + 1, close);
	const after = text.slice(close + 4).replace(LEADING_NEWLINE, '');
	let data: Record<string, unknown> = {};
	try {
		const parsed = parse_yaml(yamlBlock);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			data = parsed as Record<string, unknown>;
		}
	} catch (e) {
		// (the parser's own invalid-frontmatter error is already the answer: wrapped, it would say so twice)
		if (e instanceof OgygiaError && e.code === 'content_frontmatter_invalid') throw e;
		throw new OgygiaError('content_frontmatter_invalid', { reason: reason_of(e) });
	}
	return { data, body: after };
}
