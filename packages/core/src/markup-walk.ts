/**
 * THE TAG WALK: how ogygia reads server HTML as text, the way a browser does. Quoted values may
 * hold `>` and the other quote, a comment is skipped, a raw-text element's text holds no tag, and a
 * tag name matches whole. Every HTML reader in ogygia is a view over this one walk.
 *
 * Its own module, apart from the vocabulary (./wire-markup.ts, which re-exports it): the boot reads
 * the vocabulary (its markers, and `rule_markup_known`), and only the lazy chunks and the server
 * walk HTML, so the two never share a chunk the boot has to fetch (palaestra e2e/lazy-chunks.spec.ts).
 */

/** One tag `tags()` found: where it starts and ends in the HTML, and its attributes (names in
 *  lower case, a bare attribute's value `''`). `attr(name)` reads one attribute without building
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
	const n = html.length;
	let j = from;
	for (; j < n; j++) {
		const c = html.charCodeAt(j);
		if (c === 62 || c === 47 || (c <= 32 && is_space(c))) break;
	}
	return j;
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

/** The elements whose text the tokenizer reads raw, up to their own end tag. */
// static: the raw-text element names
const RAW_TEXT = [
	'script',
	'style',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'plaintext'
];

/** The raw-text element named `html[from, to)`, or null. */
function raw_name(html: string, from: number, to: number): string | null {
	const len = to - from;
	if (len < 3 || len > 9) return null;
	for (const r of RAW_TEXT) if (name_is(html, from, to, r)) return r;
	return null;
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
	for (;;) {
		let c = html.charCodeAt(j);
		while (c === 47 || (c <= 32 && is_space(c))) c = html.charCodeAt(++j);
		if (j >= n) return -1;
		if (c === 62) return j + 1;
		const ns = j++;
		for (; j < n; j++) {
			c = html.charCodeAt(j);
			if (c === 61 || c === 62 || c === 47 || (c <= 32 && is_space(c))) break;
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
					if (c === 62 || (c <= 32 && is_space(c))) break;
				}
				ve = j;
			}
		}
		if (sink !== null && sink(ns, ne, vs, ve, vq) === true) return -2;
	}
}

class Tag implements FoundTag {
	readonly start: number;
	readonly end: number;
	readonly next: number;
	readonly #html: string;
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
			const name = html.slice(ns, ne).toLowerCase();
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
	/** 1: a start tag, 2: an end tag. */
	kind: 0,
	/** `<` of the tag, where its name starts and ends, and just past its `>`. */
	lt: 0,
	ns: 0,
	ne: 0,
	end: 0
};

/** From `i` (in the data state), read up to the next start or end tag into `TOKEN`; false when
 *  none comes. Comments and bogus comments are stepped over. */
function step(html: string, i: number): boolean {
	const n = html.length;
	while (i < n) {
		const lt = html.indexOf('<', i);
		if (lt === -1) return false;
		const c = html.charCodeAt(lt + 1);
		if (c === 33 /* ! */ && html.startsWith('<!--', lt)) {
			// (`<!-->` and `<!--->` are whole comments; else the first `-->` or `--!>` ends it)
			if (html.charCodeAt(lt + 4) === 62) i = lt + 5;
			else if (html.startsWith('->', lt + 4)) i = lt + 6;
			else {
				// (each `--` in the comment, in order: the first one followed by `>` or `!>` ends it)
				let k = html.indexOf('--', lt + 4);
				for (;;) {
					if (k === -1) return false;
					const e = html.charCodeAt(k + 2);
					if (e === 62) {
						i = k + 3;
						break;
					}
					if (e === 33 && html.charCodeAt(k + 3) === 62) {
						i = k + 4;
						break;
					}
					k = html.indexOf('--', k + 1);
				}
			}
			continue;
		}
		if (c === 33 /* ! */ || c === 63 /* ? */) {
			const gt = html.indexOf('>', lt + 2);
			if (gt === -1) return false;
			i = gt + 1;
			continue;
		}
		if (c === 47 /* / */) {
			const d = html.charCodeAt(lt + 2);
			if (is_letter(d)) {
				const ne = name_end(html, lt + 3);
				const end = read_attrs(html, ne, null);
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
			i = gt + 1;
			continue;
		}
		if (!is_letter(c)) {
			i = lt + 1;
			continue;
		}
		const ne = name_end(html, lt + 2);
		const end = read_attrs(html, ne, null);
		if (end === -1) return false;
		TOKEN.kind = 1;
		TOKEN.lt = lt;
		TOKEN.ns = lt + 1;
		TOKEN.ne = ne;
		TOKEN.end = end;
		return true;
	}
	return false;
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

/** The start tag whose name ends at `after` (its `<` at `lt`), up to its `>`. Null when the HTML
 *  ends inside it (an unclosed tag or quoted value), as a browser drops it. */
export function read_tag(html: string, lt: number, after: number): FoundTag | null {
	const end = read_attrs(html, after, null);
	if (end === -1) return null;
	const raw = raw_name(html, lt + 1, after);
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
	while (step(html, i)) {
		if (TOKEN.kind === 2) {
			i = TOKEN.end;
			continue;
		}
		if (name_is(html, TOKEN.ns, TOKEN.ne, name)) return read_tag(html, TOKEN.lt, TOKEN.ne);
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
	while (step(html, i)) {
		if (TOKEN.kind === 2) {
			if (name_is(html, TOKEN.ns, TOKEN.ne, name)) return { close: TOKEN.lt, end: TOKEN.end };
			i = TOKEN.end;
			continue;
		}
		if (name_is(html, TOKEN.ns, TOKEN.ne, name)) {
			const tag = read_tag(html, TOKEN.lt, TOKEN.ne);
			return tag === null ? null : { tag };
		}
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

/** The first start tag of any name in `html` from `from` (as `next_tag` reads one), with its name in
 *  lower case, or null: for a rewrite that reads every tag (federation's asset pinning). */
export function next_any_tag(
	html: string,
	from: number
): { readonly name: string; readonly tag: FoundTag } | null {
	let i = from;
	while (step(html, i)) {
		if (TOKEN.kind === 2) {
			i = TOKEN.end;
			continue;
		}
		const name = html.slice(TOKEN.ns, TOKEN.ne).toLowerCase();
		const tag = read_tag(html, TOKEN.lt, TOKEN.ne);
		return tag === null ? null : { name, tag };
	}
	return null;
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
	for (let i = tag.end; step(html, i);) {
		if (TOKEN.kind === 2 && name_is(html, TOKEN.ns, TOKEN.ne, name))
			return html.slice(tag.end, TOKEN.lt);
		i = TOKEN.kind === 2 ? TOKEN.end : after_start(html);
		if (i === -1) return null;
	}
	return null;
}
