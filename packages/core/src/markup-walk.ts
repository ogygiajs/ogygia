/**
 * THE TAG WALK: how ogygia reads server HTML as text, the way a browser does. Quoted values may
 * hold `>` and the other quote, a comment is skipped, a raw-text element's text holds no tag, and a
 * tag name matches whole. Every HTML reader in ogygia is a view over this one walk.
 *
 * Its own module, apart from the vocabulary (./wire-markup.ts, which re-exports it): the boot reads
 * the vocabulary (its markers, and `rule_markup_known`), and only the lazy chunks and the server
 * walk HTML, so the two never share a chunk the boot has to fetch (palaestra e2e/lazy-chunks.spec.ts).
 */

/** One tag `tags()` found: where it starts and ends in the HTML, and its attributes (names as the
 *  browser keeps them: ASCII letters in lower case, the rest as written; a bare attribute's value
 *  `''`). `attr(name)` reads one attribute without building
 *  `attrs`; `attrs` is read once, on first use. */
export interface FoundTag {
	readonly start: number;
	readonly end: number;
	/** Where a walk goes on after this tag: past its text when it opens a raw-text element (a
	 *  script, a style…, whose text holds no tag), else `end`; `html.length` when that text never
	 *  closes. `next_tag(html, name, t.next)` is the next tag after `t`. */
	readonly next: number;
	readonly attrs: Map<string, string>;
	/** One attribute's value (`''` when bare; the first one wins), or undefined. `name` in lower case. */
	attr(name: string): string | undefined;
}

// ── THE WALK ────────────────────────────────────────────────────────────────────────────────────
// One tokenizer walk over HTML text, the browser's data state: comments (`<!-->`, `<!--->` and `--!>`
// end one too), bogus comments (`<!x …>`, `<?x …>`, CDATA, `</ …>`), end tags (their quoted values
// read, so a `>` inside one does not end it), and start tags, after which a raw-text element's text
// (script with its `<!--` escapes, style, textarea, title, xmp, iframe, noembed, noframes, noscript;
// plaintext to the end) holds no tag. Every reader below is a view over it. Pinned against parse5 by
// test/wire-markup-differential.test.ts. (Foreign content is not modelled: an `<svg>`'s `<style>`
// is read as raw text, as in HTML.)

/** HTML's whitespace inside a tag: tab, LF, FF, CR, space (NaN, past the end, is not). */
function is_space(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

/** `[A-Za-z]`: what starts a tag name (`<3` and `< p` are text). */
function is_letter(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

/** Where a tag name that starts at `from` ends (whitespace, `/`, `>` or the end). */
function name_end(html: string, from: number): number {
	let j = from;
	for (; ; j++) {
		const c = html.charCodeAt(j);
		// (a name's letters, digits and `-` are all past `>`: one test each)
		if (c > 62) continue;
		// (`c !== c`: NaN, the end of the input)
		if (c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || c !== c)
			return j;
	}
}

/** `html[from, to)`, a tag or attribute name, as the browser keeps it: its ASCII letters in lower
 *  case, every other character as written (`toLowerCase()` would fold `Ä` too, #1115). */
function name_of(html: string, from: number, to: number): string {
	const name = html.slice(from, to);
	for (let k = from; k < to; k++) {
		const c = html.charCodeAt(k);
		if (c >= 65 && c <= 90) return name.replace(/[A-Z]+/g, (up) => up.toLowerCase());
	}
	return name;
}

/** Is `html[from, to)` the lower-case ASCII `name`, in any case? */
function name_is(html: string, from: number, to: number, name: string): boolean {
	if (to - from !== name.length) return false;
	for (let k = 0; k < name.length; k++) {
		let c = html.charCodeAt(from + k);
		if (c >= 65 && c <= 90) c += 32;
		if (c !== name.charCodeAt(k)) return false;
	}
	return true;
}

/** The raw-text element named `html[from, to)`, or null: the elements whose text the tokenizer
 *  reads raw, up to their own end tag (script, style, textarea, title, xmp, iframe, noembed,
 *  noframes, noscript, plaintext), told apart by their first letter, then their length. */
function raw_name(html: string, from: number, to: number): string | null {
	switch (html.charCodeAt(from) | 32) {
		case 115 /* s */:
			return name_is(html, from, to, 'script')
				? 'script'
				: name_is(html, from, to, 'style')
					? 'style'
					: null;
		case 116 /* t */:
			return name_is(html, from, to, 'title')
				? 'title'
				: name_is(html, from, to, 'textarea')
					? 'textarea'
					: null;
		case 120 /* x */:
			return name_is(html, from, to, 'xmp') ? 'xmp' : null;
		case 105 /* i */:
			return name_is(html, from, to, 'iframe') ? 'iframe' : null;
		case 110 /* n */:
			return name_is(html, from, to, 'noscript')
				? 'noscript'
				: name_is(html, from, to, 'noembed')
					? 'noembed'
					: name_is(html, from, to, 'noframes')
						? 'noframes'
						: null;
		case 112 /* p */:
			return name_is(html, from, to, 'plaintext') ? 'plaintext' : null;
		default:
			return null;
	}
}

/** Does `</name` (any case) followed by whitespace, `/` or `>` start at `at`? */
function closes(html: string, at: number, name: string): boolean {
	if (html.charCodeAt(at) !== 60 || html.charCodeAt(at + 1) !== 47) return false;
	const end = at + 2 + name.length;
	if (!name_is(html, at + 2, end, name)) return false;
	const c = html.charCodeAt(end);
	return c === 62 || c === 47 || is_space(c);
}

/** Where the `</script` that ends a script's text (from `from`) begins (-1: none), by the
 *  tokenizer's script-data states: after `<!--` the text is ESCAPED until `-->`, and an escaped
 *  `<script` opens a DOUBLE-ESCAPED run where `</script` does not end the script. */
function script_close(html: string, from: number): number {
	let i = from;
	for (;;) {
		const lt = html.indexOf('<', i);
		if (lt === -1) return -1;
		if (closes(html, lt, 'script')) return lt;
		if (!html.startsWith('<!--', lt)) {
			i = lt + 1;
			continue;
		}
		// escaped (the `--` of `<!--` already read, so `<!-->` ends it at once)
		let j = lt + 2;
		for (;;) {
			const dash = html.indexOf('-->', j);
			const open = html.indexOf('<', j);
			if (open === -1 || (dash !== -1 && dash < open)) {
				if (dash === -1) return -1;
				i = dash + 3;
				break;
			}
			if (closes(html, open, 'script')) return open;
			const ne = name_end(html, open + 1);
			if (!name_is(html, open + 1, ne, 'script')) {
				j = open + 1;
				continue;
			}
			// double escaped: `-->` returns to script data, `</script` to escaped
			let k = ne;
			let back = -1;
			for (;;) {
				const d = html.indexOf('-->', k);
				const c = html.indexOf('</', k);
				if (d === -1 && c === -1) return -1;
				if (c !== -1 && (d === -1 || c < d)) {
					if (closes(html, c, 'script')) {
						j = c + 8;
						break;
					}
					k = c + 2;
					continue;
				}
				back = d + 3;
				break;
			}
			if (back !== -1) {
				i = back;
				break;
			}
		}
	}
}

/** Where the end tag that closes the raw text of `raw` (from `from`) starts (-1: never). */
function raw_close(html: string, from: number, raw: string): number {
	if (raw === 'script') return script_close(html, from);
	if (raw === 'plaintext') return -1;
	for (let at = html.indexOf('</', from); at !== -1; at = html.indexOf('</', at + 2))
		if (closes(html, at, raw)) return at;
	return -1;
}

/** What `read_attrs` hands each attribute: its name's span and its value's (`vq` the quote's char
 *  code, 0 when unquoted, -1 when bare: no `=`). */
type AttrSink = (ns: number, ne: number, vs: number, ve: number, vq: number) => boolean | void;

/**
 * Read a tag's attributes from `j` (just past its name) to its `>`, handing each to `sink` (which
 * may stop the read by returning true). Returns the index just past the `>`, or -1 when the input
 * ends inside the tag (the browser drops it): a quoted value may hold `>` and the other quote; an
 * unquoted one ends at whitespace or `>`; a name's first character may be `=`.
 */
function read_attrs(html: string, j: number, sink: AttrSink | null): number {
	const n = html.length;
	// (whitespace tested in line, the space first: a call per character is the read's dearest step)
	for (;;) {
		let c = html.charCodeAt(j);
		while (c === 32 || c === 47 || (c <= 13 && c >= 9 && c !== 11)) c = html.charCodeAt(++j);
		if (j >= n) return -1;
		if (c === 62) return j + 1;
		const ns = j++;
		for (; ; j++) {
			c = html.charCodeAt(j);
			// (a name's letters are all past `>`: one test each; `c !== c` is NaN, the end)
			if (c > 62) continue;
			if (
				c === 61 ||
				c === 32 ||
				c === 62 ||
				c === 47 ||
				c !== c ||
				(c <= 13 && c >= 9 && c !== 11)
			)
				break;
		}
		const ne = j;
		while (c <= 32 && is_space(c)) c = html.charCodeAt(++j);
		let vs = j;
		let ve = j;
		let vq = -1;
		if (c === 61 /* = */) {
			vq = 0;
			c = html.charCodeAt(++j);
			while (c <= 32 && is_space(c)) c = html.charCodeAt(++j);
			if (c === 34 || c === 39) {
				const close = html.indexOf(c === 34 ? '"' : "'", j + 1);
				if (close === -1) return -1;
				vq = c;
				vs = j + 1;
				ve = close;
				j = close + 1;
			} else {
				vs = j;
				for (; j < n; j++) {
					c = html.charCodeAt(j);
					if (c <= 62 && (c === 62 || c === 32 || (c <= 13 && c >= 9 && c !== 11))) break;
				}
				ve = j;
			}
		}
		if (sink !== null && sink(ns, ne, vs, ve, vq) === true) return -2;
	}
}

/** Where the tag whose name ends at `ne` ends (-1: the input ends inside it): just past the name
 *  when it ends at the `>` (an end tag, a tag with no attributes), else past its attributes. (Read
 *  a character at a time, not searched for: Heisenbench counts a search's start as dearer than most
 *  names, #1037.) */
function tag_end(html: string, ne: number): number {
	return html.charCodeAt(ne) === 62 ? ne + 1 : read_attrs(html, ne, null);
}

class Tag implements FoundTag {
	readonly start: number;
	readonly end: number;
	readonly next: number;
	readonly #html: string;
	/** just past the tag's name: where its attributes start */
	readonly #after: number;
	#all: Map<string, string> | null = null;
	constructor(start: number, end: number, next: number, html: string, after: number) {
		this.start = start;
		this.end = end;
		this.next = next;
		this.#html = html;
		this.#after = after;
	}

	get attrs(): Map<string, string> {
		if (this.#all !== null) return this.#all;
		const all = new Map<string, string>();
		const html = this.#html;
		read_attrs(html, this.#after, (ns, ne, vs, ve) => {
			const name = name_of(html, ns, ne);
			if (!all.has(name)) all.set(name, html.slice(vs, ve));
		});
		return (this.#all = all);
	}

	attr(name: string): string | undefined {
		if (this.#all !== null) return this.#all.get(name);
		const html = this.#html;
		let out: string | undefined;
		read_attrs(html, this.#after, (ns, ne, vs, ve) => {
			if (!name_is(html, ns, ne, name)) return;
			out = html.slice(vs, ve);
			return true;
		});
		return out;
	}
}

/** The walk's last token (one record, read synchronously right after `step`). */
const TOKEN = {
	/** 1: a start tag, 2: an end tag, 3: a comment (only when `step` is asked for them). */
	kind: 0,
	/** `<` of the tag, where its name starts and ends, and just past its `>`. */
	lt: 0,
	ns: 0,
	ne: 0,
	end: 0
};

/** From `i` (in the data state), read up to the next start or end tag into `TOKEN`; false when
 *  none comes. Comments and bogus comments are stepped over, or read as a token when `comments`.
 *  A start tag's attributes go to `sink` as they are read (before the tag is known to end: when the
 *  input ends inside it, step is false). */
function step(html: string, i: number, sink: AttrSink | null, comments = false): boolean {
	const n = html.length;
	while (i < n) {
		const lt = html.indexOf('<', i);
		if (lt === -1) return false;
		const c = html.charCodeAt(lt + 1);
		// (a start tag first: most `<` open one)
		if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) {
			// (`name_end` and `tag_end` in line: the walk's one step per tag)
			let ne = lt + 2;
			let e = html.charCodeAt(ne);
			while (
				e > 62 ||
				!(e === 62 || e === 32 || e === 47 || e !== e || (e <= 13 && e >= 9 && e !== 11))
			)
				e = html.charCodeAt(++ne);
			const end = e === 62 ? ne + 1 : read_attrs(html, ne, sink);
			if (end < 0) return false;
			TOKEN.kind = 1;
			TOKEN.lt = lt;
			TOKEN.ns = lt + 1;
			TOKEN.ne = ne;
			TOKEN.end = end;
			return true;
		}
		if (c === 33 /* ! */ && html.startsWith('<!--', lt)) {
			// (`<!-->` and `<!--->` are whole comments; else the first `-->` or `--!>` ends it)
			let end: number;
			if (html.charCodeAt(lt + 4) === 62) end = lt + 5;
			else if (html.startsWith('->', lt + 4)) end = lt + 6;
			else {
				// (each `--` in the comment, in order: the first one followed by `>` or `!>` ends it)
				let k = html.indexOf('--', lt + 4);
				for (;;) {
					if (k === -1) return false;
					const e = html.charCodeAt(k + 2);
					if (e === 62) {
						end = k + 3;
						break;
					}
					if (e === 33 && html.charCodeAt(k + 3) === 62) {
						end = k + 4;
						break;
					}
					k = html.indexOf('--', k + 1);
				}
			}
			if (comments) return comment_token(lt, end);
			i = end;
			continue;
		}
		if (c === 33 /* ! */ || c === 63 /* ? */) {
			const gt = html.indexOf('>', lt + 2);
			if (gt === -1) return false;
			if (comments) return comment_token(lt, gt + 1);
			i = gt + 1;
			continue;
		}
		if (c === 47 /* / */) {
			const d = html.charCodeAt(lt + 2);
			if (is_letter(d)) {
				const ne = name_end(html, lt + 3);
				const end = tag_end(html, ne);
				if (end === -1) return false;
				TOKEN.kind = 2;
				TOKEN.lt = lt;
				TOKEN.ns = lt + 2;
				TOKEN.ne = ne;
				TOKEN.end = end;
				return true;
			}
			if (d === 62 /* > */) {
				i = lt + 3;
				continue;
			}
			const gt = html.indexOf('>', lt + 2);
			if (gt === -1) return false;
			if (comments) return comment_token(lt, gt + 1);
			i = gt + 1;
			continue;
		}
		i = lt + 1;
	}
	return false;
}

/** `TOKEN` as the comment `[lt, end)` (a bogus one, or a doctype, too). */
function comment_token(lt: number, end: number): true {
	TOKEN.kind = 3;
	TOKEN.lt = lt;
	TOKEN.ns = TOKEN.ne = lt;
	TOKEN.end = end;
	return true;
}

/** Where the walk goes on after the start tag in `TOKEN`: past its text when it is a raw-text
 *  element (-1 when that text runs to the end), else just past the tag. */
function after_start(html: string): number {
	const raw = raw_name(html, TOKEN.ns, TOKEN.ne);
	if (raw === null) return TOKEN.end;
	return raw_close(html, TOKEN.end, raw);
}

/** Where the attribute `attr` (lower case) of `tag`, a `<name …>` start tag of `html`, has its value
 *  start (inside its quotes), or -1 when it is absent or has no value: where a rewrite of the value
 *  splices. A function, not a `FoundTag` method, so a bundle that never rewrites leaves it out. */
export function value_at(html: string, tag: FoundTag, name: string, attr: string): number {
	let at = -1;
	read_attrs(html, tag.start + 1 + name.length, (ns, ne, vs, _ve, vq) => {
		if (!name_is(html, ns, ne, attr)) return;
		// (a bare attribute has no value to splice into)
		at = vq === -1 ? -1 : vs;
		return true;
	});
	return at;
}

/** Where each copy of the attribute `attr` (lower case) of `tag`, a `<name …>` start tag of
 *  `html`, is, in order: from the whitespace before its name to just past its value (past the
 *  closing quote of a quoted one). What a rewrite cuts to drop the attribute, read the way the
 *  browser reads it: any quoting, spaces around `=`, any case, every copy. */
export function attr_spans(
	html: string,
	tag: FoundTag,
	name: string,
	attr: string
): Array<[start: number, end: number]> {
	const spans: Array<[number, number]> = [];
	read_attrs(html, tag.start + 1 + name.length, (ns, ne, _vs, ve, vq) => {
		if (!name_is(html, ns, ne, attr)) return;
		let start = ns;
		while (is_space(html.charCodeAt(start - 1))) start--;
		// (bare: the name alone; quoted: past the closing quote; unquoted: the value's end)
		spans.push([start, vq === -1 ? ne : vq === 0 ? ve : ve + 1]);
	});
	return spans;
}

/** The start tag whose name ends at `after` (its `<` at `lt`), up to its `>`. Null when the HTML
 *  ends inside it (an unclosed tag or quoted value), as a browser drops it. */
export function read_tag(html: string, lt: number, after: number): FoundTag | null {
	const end = tag_end(html, after);
	if (end === -1) return null;
	return found(html, lt, end, raw_name(html, lt + 1, after), after);
}

/** The start tag the walk read into `TOKEN`. */
function found_token(html: string): FoundTag {
	return found(html, TOKEN.lt, TOKEN.end, raw_name(html, TOKEN.ns, TOKEN.ne), TOKEN.ne);
}

function found(html: string, lt: number, end: number, raw: string | null, after: number): FoundTag {
	let next = end;
	if (raw !== null) {
		next = raw_close(html, end, raw);
		if (next === -1) next = html.length;
	}
	return new Tag(lt, end, next, html, after);
}

/** The first `<name …>` start tag in `html` from `from` (a point the browser reads as markup: 0,
 *  or a tag's `next`), read the way a browser reads one, or null (none, or the HTML ends inside a
 *  comment, a tag or a raw-text element's text). `next_tag(html, name, t.next)` is the one after
 *  `t`: the loop form of `tags()` for hot paths. */
export function next_tag(html: string, name: string, from: number): FoundTag | null {
	let i = from;
	while (step(html, i, null)) {
		if (TOKEN.kind === 2) {
			i = TOKEN.end;
			continue;
		}
		if (name_is(html, TOKEN.ns, TOKEN.ne, name)) return found_token(html);
		i = after_start(html);
		if (i === -1) return null;
	}
	return null;
}

/** The first start or end tag named `name` in `html` from `from`, read as `next_tag` reads them:
 *  `{ tag }` for a start tag (go on from `tag.next`), `{ close, end }` for an end tag (its `<` and
 *  just past its `>`; go on from `end`), or null. For a scan that balances an element's own tags
 *  (postrender's stitch holes). */
export function next_open_or_close(
	html: string,
	name: string,
	from: number
): { readonly tag: FoundTag } | { readonly close: number; readonly end: number } | null {
	let i = from;
	while (step(html, i, null)) {
		if (TOKEN.kind === 2) {
			if (name_is(html, TOKEN.ns, TOKEN.ne, name)) return { close: TOKEN.lt, end: TOKEN.end };
			i = TOKEN.end;
			continue;
		}
		if (name_is(html, TOKEN.ns, TOKEN.ne, name)) return { tag: found_token(html) };
		i = after_start(html);
		if (i === -1) return null;
	}
	return null;
}

/** Each `<name …>` start tag in `html` from `from`, in order, read the way a browser reads one.
 *  `name` is a tag name (lower case: letters, digits, `-`). */
export function* tags(html: string, name: string, from = 0): Generator<FoundTag> {
	for (let t = next_tag(html, name, from); t !== null; t = next_tag(html, name, t.next)) yield t;
}

/** The first start tag of any name in `html` from `from` (as `next_tag` reads one), or null: for a
 *  rewrite that reads every tag (federation's asset pinning). Its name, when wanted, is
 *  `tag_name(html, tag)`: a walk over every tag makes no string per tag. `visit` is handed each of
 *  its attributes, in source order, while the walk reads the tag (once, not read again): its name
 *  `html[ns, ne)` as written (any case, repeats included) and its value `html[vs, ve)` (`vq` the
 *  quote's char code, 0 when unquoted, -1 when bare). Null: no tag, or the HTML ended inside one
 *  (whose attributes may have been visited). */
export function next_any_tag(
	html: string,
	from: number,
	visit: ((ns: number, ne: number, vs: number, ve: number, vq: number) => void) | null = null
): FoundTag | null {
	let i = from;
	while (step(html, i, visit)) {
		if (TOKEN.kind === 2) {
			i = TOKEN.end;
			continue;
		}
		return found_token(html);
	}
	return null;
}

/** The name of `tag`, a start tag of `html`, as the browser keeps it (ASCII in lower case). */
export function tag_name(html: string, tag: FoundTag): string {
	return name_of(html, tag.start + 1, name_end(html, tag.start + 1));
}

/** Where a marker's text sits in `html`, read forward with the tags of one walk: a tag whose span
 *  does not hold it cannot carry the marker, so `holds()` lets a scan read attributes only where it
 *  can be. The needle is what every match spells: a string when the caller compares a value exactly,
 *  a global case-blind pattern when it reads an attribute name (names come in any case). */
export class Needle {
	readonly #html: string;
	readonly #needle: string | RegExp;
	#at = -1;
	/** True once the text appears nowhere from the last tag asked about on: no later tag holds it.
	 *  (A field, not a getter: scans read it once per tag.) */
	gone = true;
	constructor(html: string, needle: string | RegExp, from = 0) {
		this.#html = html;
		this.#needle = needle;
		this.#find(from);
	}

	#find(from: number): void {
		const needle = this.#needle;
		let at: number;
		if (typeof needle === 'string') at = this.#html.indexOf(needle, from);
		else {
			needle.lastIndex = from;
			at = needle.exec(this.#html)?.index ?? -1;
		}
		this.#at = at;
		this.gone = at === -1;
	}

	/** Whether `tag`'s span holds the text. Ask in document order (the tags of one walk). */
	holds(tag: FoundTag): boolean {
		if (this.#at < tag.start) {
			if (this.gone) return false;
			this.#find(tag.start);
			if (this.gone) return false;
		}
		return this.#at < tag.end;
	}
}

/** The text of the element `tag` (named `name`) opens, as written: a raw-text element's (a
 *  `<script>`, a `<style>`) up to the end tag the browser closes it with, any other's (a
 *  `<template>`, the `<head>`) up to its first `</name` outside comments and raw text. Null when it
 *  never closes. */
export function text_of(html: string, tag: FoundTag, name: string): string | null {
	const raw = raw_name(html, tag.start + 1, tag.start + 1 + name.length);
	if (raw !== null) {
		const close = raw_close(html, tag.end, raw);
		return close === -1 ? null : html.slice(tag.end, close);
	}
	// (not raw text: up to its first `</name` the walk reads, past comments and raw text inside)
	for (let i = tag.end; step(html, i, null);) {
		if (TOKEN.kind === 2 && name_is(html, TOKEN.ns, TOKEN.ne, name))
			return html.slice(tag.end, TOKEN.lt);
		i = TOKEN.kind === 2 ? TOKEN.end : after_start(html);
		if (i === -1) return null;
	}
	return null;
}

/** What a piece of `markup_tokens` is: text (a raw-text element's whole text too), a start tag, an
 *  end tag, or a comment (a bogus comment and a doctype too). */
export type MarkupKind = 0 | 1 | 2 | 3;

/** `html` cut into the pieces the browser's tokenizer reads, in order and covering it whole: each
 *  `[start, end)` handed to `visit` with its kind. For a reader that splits markup at its tags (a
 *  diff), where a `<` inside a value, a comment or a script is not a tag. Past where the HTML ends
 *  inside a tag or comment, the rest is one text piece. `ne`: where a tag's name ends (its name is
 *  `html[start + 1, ne)` for a start tag, `html[start + 2, ne)` for an end tag; `start` otherwise). */
export function markup_tokens(
	html: string,
	visit: (kind: MarkupKind, start: number, end: number, ne: number) => void
): void {
	const at = new MarkupCursor(html);
	while (at.next()) visit(at.kind, at.start, at.end, at.ne);
}

/**
 * `markup_tokens` pulled one piece at a time, for a reader that keeps its own state between pieces
 * (reshape's lexer): ONE cursor whose fields each `next()` rewrites (a document is tens of thousands
 * of pieces; an object per piece is garbage paid on every request). Read the fields before the next
 * `next()`. `raw`: a text piece that is a raw-text element's text (a script's, a style's…).
 */
export class MarkupCursor {
	kind: MarkupKind = 0;
	start = 0;
	end = 0;
	ne = 0;
	raw = false;
	readonly #html: string;
	#i = 0;
	/** the pieces one step read, not yet handed out: kind, start, end, ne, raw (up to three) */
	readonly #queue: number[] = [];
	#at = 0;
	constructor(html: string) {
		this.#html = html;
	}

	next(): boolean {
		const q = this.#queue;
		if (this.#at === q.length) {
			q.length = 0;
			this.#at = 0;
			const html = this.#html;
			const n = html.length;
			const i = this.#i;
			if (i >= n) return false;
			if (!step(html, i, null, true)) {
				// (past where the HTML ends inside a tag or comment: the rest is one text piece)
				q.push(0, i, n, i, 0);
				this.#i = n;
			} else {
				const kind = TOKEN.kind;
				const lt = TOKEN.lt;
				const end = TOKEN.end;
				let next = kind === 1 ? after_start(html) : end;
				if (next === -1) next = n;
				if (lt > i) q.push(0, i, lt, i, 0);
				q.push(kind, lt, end, TOKEN.ne, 0);
				if (next > end) q.push(0, end, next, end, 1);
				this.#i = next;
			}
		}
		const k = this.#at;
		this.kind = q[k] as MarkupKind;
		this.start = q[k + 1];
		this.end = q[k + 2];
		this.ne = q[k + 3];
		this.raw = q[k + 4] === 1;
		this.#at = k + 5;
		return true;
	}
}

/** The text of `html` as written, cut where the browser cuts it: each tag and comment, and each
 *  raw-text element's text (a script's, a style's), becomes one space. Character references are
 *  left as written. For a reader that wants words, not markup (a search index, an error page's
 *  first line). */
export function markup_text(html: string): string {
	let out = '';
	const at = new MarkupCursor(html);
	while (at.next()) out += at.kind === 0 && !at.raw ? html.slice(at.start, at.end) : ' ';
	return out;
}

/** Hand each attribute of the tag whose name ends at `from` to `visit`, in source order, as the
 *  browser reads them (`markup_tokens`' `ne`): its name `html[ns, ne)` as written (any case,
 *  repeats included) and its value `html[vs, ve)`, `vq` the quote's char code (0 unquoted, -1 bare).
 *  Where the tag ends (past its `>`), or -1 when the HTML ends inside it. */
export function visit_attrs(
	html: string,
	from: number,
	visit: (ns: number, ne: number, vs: number, ve: number, vq: number) => void
): number {
	return read_attrs(html, from, visit);
}
