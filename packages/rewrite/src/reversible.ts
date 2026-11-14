/**
 * REVERSIBLE TRANSFORMS — an app's server transform (a web-component server render, say) may reshape
 * the markup ogygia hands it, Svelte-owned markup included, and ogygia puts back what hydration needs.
 *
 * The one rule this rests on, vendor-neutral: **a custom element's server render may move its light
 * DOM children** (a scoped render emulates slots by moving them into its rendered tree). So:
 *
 *   1. MARK, before the transform: every custom element gets an id (`og-h="K"` when ogygia will restore
 *      it — in Svelte-owned markup, above Svelte-owned markup, or anywhere in a hole / lake answer;
 *      `og-u="K"` otherwise), and each of its children a tag (`og-c="K.i"` on an element, a
 *      `<!--og-c K.i t|c-->` comment before a text or comment node). Text a trimmer could change,
 *      deeper inside a restored host's children, gets `<!--og-t K.n-->`.
 *   2. The app's transform runs. On an `og-h` host it renders the plan: its slot positions as real
 *      `<slot>` wrappers, `og-shadow="key …"` (the sheets for the host's shadow root), `og-keep="attr …"`.
 *   3. SETTLE, after it: hosts without a plan (no `og-shadow`) lose every mark and are left as the
 *      transform wrote them; a planned host keeps its marks plus what the restorer needs to put the
 *      children back exactly (`og-r`: the attributes to reset; the original text of a trimmed or
 *      dropped text node). Start tags the HTML parser would restructure (an `<a>` in an `<a>`, a block
 *      in a `<p>`, …) where the render introduced the tag or the element it would close become
 *      `<og-as tag="…">` stand-ins. `data-og-head` assets move into `<head>` (a document), deduped.
 *
 * The browser half (./restore.ts) attaches each planned host's shadow root, moves the rendered
 * tree into it, and puts Svelte's children back — before anything snapshots or hydrates.
 *
 * Pure string work over one tokenizer pass each (indexOf-driven, no regex, no DOM): it runs on every
 * response of an app that configures a transform.
 */
import { escapeAttr as escape_amp_quot } from '@ogygia/core/plugin/utils';
// (both realms load this module, the browser in tests: the browser realm's entry, which the build
// writes out as the two literals)
import {
	MarkupCursor,
	next_any_tag,
	OG_BAKED,
	OG_HEAD,
	visit_attrs
} from '@ogygia/core/internal/instruments';

// ─── tokenizer ─────────────────────────────────────────────────────────────────────────────────────

type Tok =
	| { t: 'start'; name: string; start: number; end: number; name_end: number; self: boolean }
	| { t: 'end'; name: string; start: number; end: number }
	| { t: 'text'; start: number; end: number }
	| { t: 'comment'; start: number; end: number }
	| { t: 'raw'; start: number; end: number }
	| { t: 'other'; start: number; end: number };

const VOID: ReadonlySet<string> = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr',
	'param',
	'keygen',
	'frame'
]);

function is_space(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}
function is_alpha(c: number): boolean {
	return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/** Where a tag name starting at `from` ends: for `has_custom_element`'s hop, which only asks whether
 *  a page may hold a custom element (a false yes costs one full read by the walk, never a miss). */
function read_name(html: string, from: number): number {
	let i = from;
	while (i < html.length) {
		const c = html.charCodeAt(i);
		if (is_space(c) || c === 62 || c === 47) break;
		i++;
	}
	return i;
}

/** A tag name, lower-cased only when it has an upper-case letter (the common case allocates nothing
 *  beyond the slice). */
export function tag_name(html: string, from: number, to: number): string {
	const name = html.slice(from, to);
	for (let k = from; k < to; k++) {
		const c = html.charCodeAt(k);
		if (c >= 65 && c <= 90) return name.toLowerCase();
	}
	return name;
}

/**
 * The tokenizer: ONE token object, rewritten in place by each `next()` (a document is tens of
 * thousands of tokens; an object per token, or a generator, is garbage the collector pays for on
 * every request). Read a token's fields before the next `next()`.
 */
class Lexer {
	t: Tok['t'] = 'text';
	name = '';
	start = 0;
	end = 0;
	name_end = 0;
	self = false;
	readonly #html: string;
	readonly #at: MarkupCursor;
	constructor(html: string) {
		this.#html = html;
		this.#at = new MarkupCursor(html);
	}
	next(): boolean {
		const at = this.#at;
		if (!at.next()) return false;
		const html = this.#html;
		this.start = at.start;
		this.end = at.end;
		switch (at.kind) {
			case 0:
				this.t = at.raw ? 'raw' : 'text';
				break;
			case 1:
				this.t = 'start';
				this.name = tag_name(html, at.start + 1, at.ne);
				this.name_end = at.ne;
				this.self = html.charCodeAt(at.end - 2) === 47;
				break;
			case 2:
				this.t = 'end';
				this.name = tag_name(html, at.start + 2, at.ne);
				break;
			default:
				this.t = html.startsWith('<!--', at.start) ? 'comment' : 'other';
		}
		return true;
	}
}

// ─── attributes (no regex: this runs on every start tag of every response) ─────────────────────────

interface Attr {
	name: string;
	value: string;
	/** span of the whole attribute (name through value), for removal */
	start: number;
	end: number;
}

/** (the attributes of a tag nobody asked about: one shared empty list, never an allocation per tag) */
const NO_ATTRS: readonly Attr[] = Object.freeze([]) as readonly Attr[];
/** (nothing to remove from a tag without ogygia's marks; only a tag with marks ever adds to its set) */
// static: the empty set, shared and never written
const NO_REMOVE = new Set<string>();

/** The attributes of the start tag whose name ends at `from`, read by core's tag walk as the browser
 *  reads them, in source order (repeats included: a remover drops every copy). */
function parse_attrs(html: string, from: number): Attr[] {
	const out: Attr[] = [];
	visit_attrs(html, from, (ns, ne, vs, ve, vq) => {
		let end = ne;
		if (vq !== -1) end = vq === 0 ? ve : ve + 1;
		out.push({
			name: html.slice(ns, ne).toLowerCase(),
			value: vq === -1 ? '' : decode(html.slice(vs, ve)),
			start: ns,
			end
		});
	});
	return out;
}

const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	'#39': "'"
};

/** Decode character references (the common named ones and every numeric one): enough to compare two
 *  serializations of the same text or attribute value. */
export function decode(s: string): string {
	if (s.indexOf('&') === -1) return s;
	let out = '';
	let i = 0;
	for (;;) {
		const amp = s.indexOf('&', i);
		if (amp === -1) return out + s.slice(i);
		out += s.slice(i, amp);
		const semi = s.indexOf(';', amp);
		if (semi === -1 || semi - amp > 10) {
			out = `${out}&`;
			i = amp + 1;
			continue;
		}
		const ref = s.slice(amp + 1, semi);
		let ch: string | undefined;
		if (ref.charCodeAt(0) === 35) {
			const code =
				ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
			if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) ch = String.fromCodePoint(code);
		} else ch = NAMED[ref];
		if (ch === undefined) {
			out = `${out}&`;
			i = amp + 1;
		} else {
			out += ch;
			i = semi + 1;
		}
	}
}

/** JSON safe inside an HTML comment: no `--`, no `>`. */
function comment_json(v: unknown): string {
	return replace_all(replace_all(JSON.stringify(v), '-', '\\u002d'), '>', '\\u003e');
}
function script_json(v: unknown): string {
	return replace_all(JSON.stringify(v), '<', '\\u003c');
}
/** `replaceAll` behind a native search: no copy when there is nothing to replace. */
function replace_all(s: string, from: string, to: string): string {
	return s.indexOf(from) === -1 ? s : s.replaceAll(from, to);
}

// ─── the open-element stack, with the parser's implied closes ──────────────────────────────────────

const P_CLOSERS: ReadonlySet<string> = new Set([
	'address',
	'article',
	'aside',
	'blockquote',
	'center',
	'details',
	'dialog',
	'dir',
	'div',
	'dl',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'header',
	'hgroup',
	'main',
	'menu',
	'nav',
	'ol',
	'p',
	'search',
	'section',
	'summary',
	'ul',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'pre',
	'listing',
	'table',
	'hr',
	'xmp',
	'li',
	'dd',
	'dt',
	'plaintext'
]);
const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SCOPE: ReadonlySet<string> = new Set([
	'applet',
	'caption',
	'html',
	'table',
	'td',
	'th',
	'marquee',
	'object',
	'template',
	'foreignobject',
	'desc'
]);

interface Frame {
	name: string;
	/** a custom element's id (K), or -1 */
	host: number;
	/** index of the next child of this element (for a host: the tag counter) */
	next: number;
	/** inside Svelte-owned markup */
	owned: boolean;
	/** mark: inside the children of a planned host (the nearest one), -1 if none */
	under: number;
	/** settle: the render introduced this element (inside a host, not inside a tagged child) */
	introduced: boolean;
	/** settle: a stand-in's real tag */
	as?: string;
	/** inside svg / math */
	foreign: boolean;
	/** the region kind this element opened (an `<ogygia-region>`) */
	region?: 'island' | 'lake' | 'hole';
}

/** The open-element stack, with a count of the open elements the parser's implied closes ask about:
 *  a start tag checks "is a `<p>` (an `<a>`, a `<li>` …) open?" — almost always no, answered by a
 *  count instead of a walk of the stack on every tag. Mutate it only through `push` / `cut`. */
type Stack<F extends { name: string } = Frame> = F[] & {
	/** per frame, the tracked name's slot (-1: untracked) — kept beside the frames, small integers */
	slots?: number[];
	/** per tracked name, how many are open */
	open?: number[];
};
const TRACKED: ReadonlyMap<string, number> = new Map(
	['a', 'nobr', 'button', 'form', 'li', 'dd', 'dt', 'p', 'td', 'th', 'tr'].map((n, i) => [n, i])
);
/** Every tag `implied_close` acts on: the only tags settle ever writes as a stand-in, and the only
 *  ones the restorer swaps one back to (./restore.ts keeps its own copy; a test holds them equal). */
export const STAND_IN_TAGS: ReadonlySet<string> = new Set([
	...TRACKED.keys(),
	...P_CLOSERS,
	'option',
	'optgroup'
]);

function push<F extends { name: string }>(stack: Stack<F>, f: F): void {
	const slot = TRACKED.get(f.name) ?? -1;
	(stack.slots ??= []).push(slot);
	if (slot !== -1) (stack.open ??= Array.from({ length: TRACKED.size }, () => 0))[slot]++;
	stack.push(f);
}

/** Close the elements from `k` up. */
function cut<F extends { name: string }>(stack: Stack<F>, k: number): void {
	const slots = stack.slots;
	if (slots) {
		const open = stack.open;
		if (open) for (let j = slots.length - 1; j >= k; j--) if (slots[j] !== -1) open[slots[j]]--;
		slots.length = k;
	}
	stack.length = k;
}

/** The index of the open `name` in scope, or -1. (A stand-in `<og-as tag="a">` is not an `<a>` to
 *  the parser: the element's own name is what counts.) */
function in_scope(
	stack: Stack<{ name: string }>,
	name: string,
	extra?: ReadonlySet<string>
): number {
	const slot = TRACKED.get(name);
	if (slot === undefined || !stack.open?.[slot]) return -1;
	for (let k = stack.length - 1; k >= 0; k--) {
		const f = stack[k];
		if (f.name === name) return k;
		if (SCOPE.has(f.name) || extra?.has(f.name)) return -1;
	}
	return -1;
}
const BUTTON_SCOPE: ReadonlySet<string> = new Set(['button']);
const LIST_SCOPE: ReadonlySet<string> = new Set(['ol', 'ul']);
/** `implied_close`: the parser ignores this start tag (a form in a form) */
const DROP = -2;

/** What the parser does to the stack BEFORE inserting start tag `name`: the index of the element it
 *  would close (and everything above it), -1 for nothing, or `DROP` (it ignores the tag). A number,
 *  never an object: this runs on every start tag. */
function implied_close(stack: Stack<{ name: string }>, name: string): number {
	if (name === 'a' || name === 'nobr' || name === 'button') return in_scope(stack, name);
	if (name === 'form') return in_scope(stack, 'form') === -1 ? -1 : DROP;
	if (name === 'li') {
		const li = in_scope(stack, 'li', LIST_SCOPE);
		if (li !== -1) return li;
	}
	if (name === 'dd' || name === 'dt') {
		const k = Math.max(in_scope(stack, 'dd'), in_scope(stack, 'dt'));
		if (k !== -1) return k;
	}
	if (P_CLOSERS.has(name)) {
		const p = in_scope(stack, 'p', BUTTON_SCOPE);
		if (p !== -1) return p;
		if (HEADINGS.has(name)) {
			const top = stack[stack.length - 1];
			if (top && HEADINGS.has(top.name)) return stack.length - 1;
		}
	}
	if (name === 'option' || name === 'optgroup') {
		const top = stack[stack.length - 1];
		if (top && top.name === 'option') return stack.length - 1;
	}
	if (name === 'td' || name === 'th') {
		const k = Math.max(in_scope(stack, 'td'), in_scope(stack, 'th'));
		if (k !== -1) return k;
	}
	if (name === 'tr') {
		const k = in_scope(stack, 'tr');
		if (k !== -1) return k;
	}
	return -1;
}

/** The page's open elements around a matched element, as the parser keeps them: what
 *  {@link settle} needs (its `context`) to know a render's tag the page would restructure. */
export type PageTags = Stack<{ name: string; shadow?: true }>;

/** A start tag of the page, its name ending at `name_end`: the parser's implied closes, then the
 *  element opened (a `<template shadowrootmode>` marked `shadow`: a declarative shadow root). */
export function page_open(
	tags: PageTags,
	html: string,
	name: string,
	name_end: number,
	self: boolean
): void {
	const close = implied_close(tags, name);
	if (close === DROP) return;
	if (close !== -1) cut(tags, close);
	if (VOID.has(name) || self) return;
	if (name === 'template')
		for (const a of parse_attrs(html, name_end))
			if (a.name === 'shadowrootmode') return push(tags, { name, shadow: true });
	push(tags, { name });
}

/** An end tag of the page. */
export function page_close(tags: PageTags, name: string): void {
	pop_to(tags, name);
}

/** An end tag: close up to the innermost element of that name (a stand-in answers to its real tag,
 *  whose end tag the settle pass rewrites). */
function pop_to(stack: Stack<{ name: string; as?: string }>, name: string): void {
	for (let k = stack.length - 1; k >= 0; k--) {
		if ((stack[k].as ?? stack[k].name) === name) {
			cut(stack, k);
			return;
		}
	}
}

function is_custom(name: string, foreign: boolean): boolean {
	if (foreign || name.indexOf('-') === -1 || !is_alpha(name.charCodeAt(0))) return false;
	return !name.startsWith('ogygia-') && !name.startsWith('og-');
}

/** Who renders a region's inside, for Svelte ownership: a hole's and a lake's are opaque to any
 *  hydration — and so is a BAKED live region's (its first HTML is one `{@html}` string to Svelte), the
 *  same set the client calls opaque (region-attrs.ts `OPAQUE_SELECTOR`). Restoring a host in there to
 *  Svelte's render undid what the server's transform wrote for no hydration to follow (a closed
 *  dropdown lost `hidden` and pushed the page down until its own runtime set it again). */
function region_kind(attrs: Attr[]): 'island' | 'lake' | 'hole' {
	if (attrs.some((a) => a.name === 'endpoint')) return 'hole';
	if (attrs.some((a) => (a.name === 'wake' && a.value === 'none') || a.name === OG_BAKED))
		return 'lake';
	return 'island';
}

/** The kind of the `<ogygia-region>` whose name ends at `name_end`. */
export function region_at(html: string, name_end: number): 'island' | 'lake' | 'hole' {
	return region_kind(parse_attrs(html, name_end));
}

/** Is `name` (lower-case) a custom element's name outside svg and math, and not ogygia's own? */
export function custom_name(name: string): boolean {
	return is_custom(name, false);
}

/** Text the serializer could change: whitespace-only, or with leading / trailing whitespace. */
function trimmable(s: string): boolean {
	if (!s.length) return false;
	const a = s.charCodeAt(0);
	const b = s.charCodeAt(s.length - 1);
	return (
		is_space(a) ||
		is_space(b) ||
		a === 160 ||
		b === 160 ||
		s.indexOf('&nbsp;') !== -1 ||
		s.indexOf('&#160;') !== -1
	);
}

// ─── mark ──────────────────────────────────────────────────────────────────────────────────────────

/** `document`: a page render. `region`: a region answer (a hole, a lake remount) — every custom
 *  element in it gets a plan, since the page morphs it over live hosts. */
export type TransformKind = 'document' | 'region';

interface HostRecord {
	planned: boolean;
	/** inside Svelte-owned markup (its children are hydrated): the dev check compares these */
	owned: boolean;
	attrs: Record<string, string>;
	/** child i: an element's attributes, a text node's original text */
	children: Map<number, { attrs?: Record<string, string>; text?: string }>;
	/** og-t n: the original text */
	texts: Map<number, string>;
	text_next: number;
	/** the original inner HTML span, for the dev check */
	inner_start: number;
	inner_end: number;
}

/** (the record of a host ogygia won't restore: shared, never written) */
const NO_RECORD: Record<string, string> = Object.freeze({}) as Record<string, string>;
// static: the empty record, shared and never written
const NO_CHILDREN: HostRecord['children'] = new Map();
// static: the empty record, shared and never written
const NO_TEXTS: HostRecord['texts'] = new Map();

export interface MarkRecord {
	kind: TransformKind;
	source: string;
	hosts: Map<number, HostRecord>;
}

const attr_map = (attrs: Attr[]): Record<string, string> => {
	const m: Record<string, string> = {};
	for (const a of attrs) m[a.name] = a.value;
	return m;
};

/**
 * Which custom elements (in document order) get a plan: every one in an ANSWER — markup the runtime
 * morphs into a live page (a hole / lake answer, or a document the router fetched: `answer`) — whose
 * hosts meet live ones its own runtime already rendered, so they must arrive in the form the restorer
 * gives (Svelte's children in the light DOM), never in the transform's server form only the
 * component's first hydrate reads (that form, morphed into a live host, left the transform's tree in
 * its light DOM: a site nav collapsed to one unstyled item after an in-place navigation). In a
 * document loaded as one, every one in Svelte-owned markup, and every one with Svelte-owned markup or
 * a hole below it (a server-owned host around an island or a hole: adopting it would reach into a
 * region ogygia hydrates or swaps — a web component relocating its slotted children moved a hole's
 * fallback twice, and its tabs kept a second copy of a document listener). A first pass, so the
 * marking pass knows a host's plan before it reaches the host's children.
 */
function plan_hosts(html: string, o: MarkOptions): boolean[] {
	const kind: TransformKind = o.doc ? 'document' : 'region';
	const csr = o.csr;
	const planned: boolean[] = [];
	const stack: Stack<{ name: string; host: number; owned: boolean; foreign: boolean }> = [];
	let in_body = kind !== 'document';
	for (const tok = new Lexer(html); tok.next();) {
		if (tok.t === 'start') {
			const name = tok.name;
			if (name === 'body') in_body = true;
			const close = implied_close(stack, name);
			if (close === DROP) continue;
			if (close !== -1) cut(stack, close);
			const parent = stack[stack.length - 1];
			const foreign = name === 'svg' || name === 'math' || !!parent?.foreign;
			let owned =
				(name === 'body' && kind === 'document' && csr) || (parent ? parent.owned : o.owned);
			// a hole: ogygia swaps its inside rather than hydrating it — not Svelte-owned, but reached into
			let swapped = false;
			if (name === 'ogygia-region') {
				const region = region_kind(parse_attrs(html, tok.name_end));
				owned = region === 'island';
				swapped = region === 'hole';
			}
			let host = -1;
			if (in_body && is_custom(name, foreign)) {
				host = planned.length;
				planned.push(o.all || owned);
			}
			// markup ogygia hydrates (Svelte-owned) or swaps (a hole) starts here: every host above it gets the plan
			if ((owned || swapped) && !(parent ? parent.owned : o.owned))
				for (const f of stack) if (f.host !== -1) planned[f.host] = true;
			if (!(VOID.has(name) || (tok.self && foreign))) push(stack, { name, host, owned, foreign });
		} else if (tok.t === 'end') {
			pop_to(stack, tok.name);
		}
	}
	return planned;
}

/** Is there any custom element (in a document: after `<body`) — a hop from `<` to `<` reading only
 *  tag names, no tokenization. Most pages of most apps have none, and then there is nothing to mark. */
function has_custom_element(html: string, document: boolean): boolean {
	// oxlint-disable-next-line ogygia/one-markup-walk -- a prefilter, a false yes only
	let at = document ? html.indexOf('<body') : 0;
	if (at === -1) return false;
	for (at = html.indexOf('<', at); at !== -1; at = html.indexOf('<', at + 1)) {
		if (!is_alpha(html.charCodeAt(at + 1))) continue;
		const ne = read_name(html, at + 1);
		const dash = html.indexOf('-', at + 1);
		if (dash !== -1 && dash < ne && is_custom(tag_name(html, at + 1, ne), false)) return true;
	}
	return false;
}

/**
 * Tag `html` for the transform. `csr`: a Kit-hydrated document (its whole body is Svelte's, except
 * lakes and holes). `answer`: a document the router fetched, morphed into the live page (every host
 * planned, as in a region answer — see `plan_hosts`). Returns the tagged HTML, or `null` when there is
 * no custom element to tag (the transform then gets the HTML as is, and settle has nothing to do).
 */
export function mark(
	html: string,
	kind: TransformKind,
	csr: boolean,
	answer = false
): { html: string; record: MarkRecord } | null {
	if (!has_custom_element(html, kind === 'document')) return null;
	return mark_with(html, {
		doc: kind === 'document',
		csr,
		all: answer || kind !== 'document',
		owned: false
	});
}

/** How {@link mark_with} reads the markup it marks. */
export interface MarkOptions {
	/** a whole document: custom elements count from `<body` on, and `csr` makes the body Svelte's */
	doc: boolean;
	csr: boolean;
	/** every host gets a plan (an answer) */
	all: boolean;
	/** the markup sits inside Svelte-owned markup (an element cut out of a page at that point) */
	owned: boolean;
}

/** {@link mark} with the reading spelled out: for one element cut out of a page, where the page
 *  around it decides whether it sits in Svelte-owned markup. */
export function mark_with(
	html: string,
	o: MarkOptions
): { html: string; record: MarkRecord } | null {
	const kind: TransformKind = o.doc ? 'document' : 'region';
	const csr = o.csr;
	const planned = plan_hosts(html, o);
	if (!planned.length) return null;
	const out: string[] = [];
	let pos = 0;
	const hosts = new Map<number, HostRecord>();
	let next_k = 0;
	const stack: Stack = [];
	let in_body = kind !== 'document';
	let last_was_pre_start = false;

	const top = () => stack[stack.length - 1];
	const under_now = () => (top() ? top().under : -1);

	for (const tok = new Lexer(html); tok.next();) {
		if (tok.t === 'start') {
			const name = tok.name;
			if (name === 'body') in_body = true;
			const close = implied_close(stack, name);
			if (close === DROP) continue;
			let escapes = false;
			if (close !== -1) {
				for (let j = close; j < stack.length; j++) if (stack[j].host !== -1) escapes = true;
				cut(stack, close);
			}
			const parent = top();
			const foreign = name === 'svg' || name === 'math' || !!parent?.foreign;
			const custom = in_body && is_custom(name, foreign);
			const child_of_host = !!parent && parent.host !== -1 && in_body;
			// attributes are read only where something records them: a region's kind, a template's
			// shadow mode, a host ogygia restores, a child of one (a host it won't restore records none)
			const recorded =
				(custom && planned[next_k] === true) || (child_of_host && planned[parent.host] === true);
			const attrs =
				name === 'ogygia-region' || name === 'template' || recorded
					? parse_attrs(html, tok.name_end)
					: (NO_ATTRS as Attr[]);
			// (a Kit-hydrated document: Svelte owns its whole body, lakes and holes aside)
			let owned =
				(name === 'body' && kind === 'document' && csr) || (parent ? parent.owned : o.owned);
			if (name === 'ogygia-region') owned = region_kind(attrs) === 'island';
			// the child tag: this element is child i of the custom element above it (a declarative
			// shadow template is not a child once parsed: it becomes the host's shadow root)
			let insert = escapes && in_body ? ' og-s' : '';
			const shadow_tpl = name === 'template' && attrs.some((a) => a.name === 'shadowrootmode');
			if (child_of_host && !shadow_tpl) {
				const i = parent.next++;
				insert = `${insert} og-c="${parent.host}.${i}"`;
				if (planned[parent.host])
					hosts.get(parent.host)!.children.set(i, { attrs: attr_map(attrs) });
			}
			let host = -1;
			if (custom) {
				host = next_k++;
				const is_planned = planned[host] ?? false;
				// (a host ogygia won't restore: its marks are stripped whatever the transform does —
				// nothing about it is recorded, no maps made)
				hosts.set(host, {
					planned: is_planned,
					owned,
					attrs: is_planned ? attr_map(attrs) : NO_RECORD,
					children: is_planned ? new Map() : NO_CHILDREN,
					texts: is_planned ? new Map() : NO_TEXTS,
					text_next: 0,
					inner_start: tok.end,
					inner_end: tok.end
				});
				insert += is_planned ? ` og-h="${host}"` : ` og-u="${host}"`;
			}
			if (insert) {
				out.push(html.slice(pos, tok.name_end), insert);
				pos = tok.name_end;
			}
			if (!(VOID.has(name) || (tok.self && foreign))) {
				push(stack, {
					name,
					host,
					next: 0,
					owned,
					// the text marks: inside a planned host's children, the nearest planned host
					under: host !== -1 && planned[host] ? host : under_now(),
					introduced: false,
					foreign
				});
			}
			last_was_pre_start = name === 'pre' || name === 'listing';
			continue;
		}
		if (tok.t === 'end') {
			const name = tok.name;
			for (let k = stack.length - 1; k >= 0; k--) {
				if (stack[k].name === name) {
					for (let j = stack.length - 1; j >= k; j--) {
						const f = stack[j];
						if (f.host !== -1) hosts.get(f.host)!.inner_end = tok.start;
					}
					cut(stack, k);
					break;
				}
			}
			last_was_pre_start = false;
			continue;
		}
		if (tok.t === 'text' || tok.t === 'comment') {
			const parent = top();
			if (parent && parent.host !== -1 && in_body && !hosts.get(parent.host)!.planned) {
				// a host ogygia will not restore: only its element children carry a tag (the stand-in
				// pass reads those); a comment before a text or comment node would sit between a
				// position-based adopter's own marker and its node
				parent.next++;
			} else if (parent && parent.host !== -1 && in_body) {
				const i = parent.next++;
				const rec = hosts.get(parent.host)!;
				if (tok.t === 'text') {
					const raw = html.slice(tok.start, tok.end);
					rec.children.set(i, { text: raw });
					out.push(html.slice(pos, tok.start), `<!--og-c ${parent.host}.${i} t-->`);
				} else {
					rec.children.set(i, {});
					out.push(html.slice(pos, tok.start), `<!--og-c ${parent.host}.${i} c-->`);
				}
				pos = tok.start;
			} else if (tok.t === 'text' && parent && under_now() !== -1 && !last_was_pre_start) {
				const raw = html.slice(tok.start, tok.end);
				if (trimmable(raw)) {
					const k = under_now();
					const rec = hosts.get(k)!;
					const n = rec.text_next++;
					rec.texts.set(n, raw);
					out.push(html.slice(pos, tok.start), `<!--og-t ${k}.${n}-->`);
					pos = tok.start;
				}
			}
			last_was_pre_start = false;
			continue;
		}
		last_was_pre_start = false;
	}
	if (!hosts.size) return null;
	out.push(html.slice(pos));
	return { html: out.join(''), record: { kind, source: html, hosts } };
}

/** Does `html` close everything it opens, and nothing it did not? A render's result is spliced into
 *  the page in place of its element: an unclosed tag, comment or raw-text element there would take
 *  in the rest of the page, and a stray end tag would close an element of the page around it. */
export function closes_all(html: string): boolean {
	const stack: Stack<{ name: string; foreign: boolean }> = [];
	for (const at = new MarkupCursor(html); at.next();) {
		if (at.kind === 1) {
			const name = tag_name(html, at.start + 1, at.ne);
			const close = implied_close(stack, name);
			if (close === DROP) continue;
			if (close !== -1) cut(stack, close);
			const parent = stack[stack.length - 1];
			const foreign = name === 'svg' || name === 'math' || !!parent?.foreign;
			const self = html.charCodeAt(at.end - 2) === 47;
			if (!(VOID.has(name) || (self && foreign))) push(stack, { name, foreign });
		} else if (at.kind === 2) {
			const name = tag_name(html, at.start + 2, at.ne);
			let k = stack.length - 1;
			while (k >= 0 && stack[k].name !== name) k--;
			if (k === -1) return false;
			cut(stack, k);
		} else if (at.kind === 0 && !at.raw && at.end === html.length && opens_at_end(html, at.start))
			return false;
	}
	return stack.length === 0;
}

function opens_at_end(html: string, from: number): boolean {
	for (let lt = html.indexOf('<', from); lt !== -1; lt = html.indexOf('<', lt + 1)) {
		const c = html.charCodeAt(lt + 1);
		if (is_alpha(c) || c === 33 || c === 47 || c === 63) return true;
	}
	return false;
}

// ─── settle ────────────────────────────────────────────────────────────────────────────────────────

/** How the stand-ins keep their element's box before the restore swaps them back (zero specificity:
 *  the component's own class rules still win). */
export const STAND_IN_CSS: string = `:where(og-as){display:inline}:where(og-as[tag=address],og-as[tag=article],og-as[tag=aside],og-as[tag=blockquote],og-as[tag=center],og-as[tag=details],og-as[tag=dialog],og-as[tag=dir],og-as[tag=div],og-as[tag=dl],og-as[tag=dd],og-as[tag=dt],og-as[tag=fieldset],og-as[tag=figcaption],og-as[tag=figure],og-as[tag=footer],og-as[tag=form],og-as[tag=header],og-as[tag=hgroup],og-as[tag=main],og-as[tag=menu],og-as[tag=nav],og-as[tag=ol],og-as[tag=p],og-as[tag=search],og-as[tag=section],og-as[tag=summary],og-as[tag=ul],og-as[tag=h1],og-as[tag=h2],og-as[tag=h3],og-as[tag=h4],og-as[tag=h5],og-as[tag=h6],og-as[tag=pre],og-as[tag=listing],og-as[tag=hr],og-as[tag=xmp]){display:block}:where(og-as[tag=li]){display:list-item}:where(og-as[tag=table]){display:table}:where(og-as[tag=button]){display:inline-block}`;

export interface Settled {
	html: string;
	/** planned hosts (with a shadow plan) — the page needs the restorer */
	planned: number;
	/** stand-ins written */
	stand_ins: number;
	/** `data-og-head` assets lifted out of a document's body, for its head (deduped by key) */
	head: string[];
	/** dev: each planned Svelte-owned host's original children, for the browser's check */
	check?: Record<string, string>;
}

/** The attributes a restore resets: `name → Svelte's value`, or `null` to remove. */
function attr_diff(
	now: Attr[],
	was: Record<string, string>,
	keep: Set<string>
): Record<string, string | null> | null {
	let diff: Record<string, string | null> | null = null;
	const seen = new Set<string>();
	for (const a of now) {
		if (a.name.startsWith('og-')) continue;
		seen.add(a.name);
		if (a.name in was) {
			if (was[a.name] !== a.value) (diff ??= {})[a.name] = was[a.name];
		} else if (!keep.has(a.name)) (diff ??= {})[a.name] = null;
	}
	for (const name in was)
		if (!seen.has(name) && !name.startsWith('og-')) (diff ??= {})[name] = was[name];
	return diff;
}

/** Rewrite a start tag: drop the attributes named in `drop`, append `add`, rename to `rename`. */
function rewrite_start(
	html: string,
	tok: { start: number; end: number; name_end: number },
	attrs: Attr[],
	drop: Set<string>,
	add: string,
	rename?: string
): string {
	let s = `<${rename ?? html.slice(tok.start + 1, tok.name_end)}`;
	let at = tok.name_end;
	for (const a of attrs) {
		if (!drop.has(a.name)) continue;
		// (with the whitespace before it: ogygia inserted its marks as ` og-…`)
		let from = a.start;
		while (from > at && is_space(html.charCodeAt(from - 1))) from--;
		s += html.slice(at, from);
		at = a.end;
	}
	const close = html.charCodeAt(tok.end - 2) === 47 ? tok.end - 2 : tok.end - 1;
	return s + html.slice(at, close) + add + html.slice(close, tok.end);
}

export function settle(
	html: string,
	record: MarkRecord,
	opts: { dev?: boolean; context?: readonly string[] } = {}
): Settled {
	// pass 1: the planned hosts the transform gave a plan — only the tags carrying `og-shadow`, found
	// by one forward indexOf walk (no second tokenization; never a per-tag search, which is quadratic
	// in the gap to the next mark)
	const plan = new Set<number>();
	for (let at = html.indexOf(' og-shadow='); at !== -1; at = html.indexOf(' og-shadow=', at + 11)) {
		const lt = html.lastIndexOf('<', at);
		if (lt === -1) continue;
		// (the tag that starts there, read by core's walk, must hold the mark: a `<` inside an
		// attribute value, or text, is not this tag's start)
		const t = next_any_tag(html, lt);
		if (t === null || t.start !== lt || t.end <= at) continue;
		const h = t.attr('og-h');
		if (h !== undefined) plan.add(Number(decode(h)));
	}
	/** Does the tag at `[from, to)` hold `needle`? A forward-only cursor: tags come in document order,
	 *  so each occurrence is searched for once (a search from every tag is quadratic in the gaps). */
	const within = (needle: string) => {
		let at = html.indexOf(needle);
		return (from: number, to: number) => {
			if (at !== -1 && at < from) at = html.indexOf(needle, from);
			return at !== -1 && at < to;
		};
	};
	const og_in = within(' og-');
	const head_in = within(OG_HEAD);
	const out: string[] = [];
	let pos = 0;
	const stack: Stack = [];
	for (const name of opts.context ?? [])
		push(stack, {
			name,
			host: -1,
			next: 0,
			owned: false,
			under: -1,
			introduced: false,
			foreign: false
		});
	const head: string[] = [];
	const head_keys = new Set<string>();
	let head_cut: { start: number; name: string; depth: number; key: string } | null = null;
	let stand_ins = 0;
	let pending_text: { k: number; i: number; comment_at: number; og: 'c' | 't' } | null = null;
	const doc = record.kind === 'document';

	/** Close a pending text mark: `text` is the text that follows it in the output (or null: none). */
	const finish_text = (text: string | null) => {
		const p = pending_text!;
		pending_text = null;
		const rec = record.hosts.get(p.k);
		const was = p.og === 'c' ? rec?.children.get(p.i)?.text : rec?.texts.get(p.i);
		if (was === undefined) {
			out[p.comment_at] = '';
			return;
		}
		if (!plan.has(p.k)) {
			// a host with no plan: its mark goes. But a render around it may still have trimmed or dropped
			// the text (a planned host's serializer writes everything below it): then it becomes a text
			// mark of the nearest planned host above, which puts it back when it is restored
			out[p.comment_at] = '';
			if (text === null || decode(text) !== decode(was)) {
				for (let s = stack.length - 1; s >= 0; s--) {
					const a = stack[s].host;
					if (a === -1 || !plan.has(a)) continue;
					const ra = record.hosts.get(a);
					if (ra)
						out[p.comment_at] = `<!--og-t ${a}.${ra.text_next++} ${comment_json(decode(was))}-->`;
					break;
				}
			}
			return;
		}
		if (p.og === 't') {
			out[p.comment_at] =
				text !== null && decode(text) === decode(was)
					? ''
					: `<!--og-t ${p.k}.${p.i} ${comment_json(decode(was))}-->`;
			return;
		}
		out[p.comment_at] =
			text !== null && decode(text) === decode(was)
				? `<!--og-c ${p.k}.${p.i} t-->`
				: `<!--og-c ${p.k}.${p.i} t ${comment_json(decode(was))}-->`;
	};

	for (const tok = new Lexer(html); tok.next();) {
		// inside a head asset being lifted out of a document's body: nothing to rewrite until its end
		if (head_cut) {
			if (tok.t === 'end' && tok.name === head_cut.name && --head_cut.depth === 0) {
				const asset = html.slice(head_cut.start, tok.end);
				pos = tok.end;
				if (!head_keys.has(head_cut.key)) {
					head_keys.add(head_cut.key);
					head.push(asset);
				}
				head_cut = null;
			} else if (tok.t === 'start' && tok.name === head_cut.name) head_cut.depth++;
			continue;
		}
		if (pending_text && tok.t !== 'text') finish_text(null);
		if (tok.t === 'text') {
			if (pending_text) {
				out.push(html.slice(pos, tok.start));
				pos = tok.start;
				finish_text(html.slice(tok.start, tok.end));
			}
			continue;
		}
		if (tok.t === 'comment') {
			const body = html.slice(tok.start + 4, tok.end - 3);
			const is_c = body.startsWith('og-c ');
			const is_t = body.startsWith('og-t ');
			if (!is_c && !is_t) continue;
			const sp = body.indexOf(' ', 5);
			const id = body.slice(5, sp === -1 ? body.length : sp);
			const dot = id.indexOf('.');
			const k = Number(id.slice(0, dot));
			const i = Number(id.slice(dot + 1));
			out.push(html.slice(pos, tok.start));
			pos = tok.end;
			if (is_c && body.endsWith(' c')) {
				out.push(plan.has(k) ? html.slice(tok.start, tok.end) : '');
				continue;
			}
			out.push(''); // filled by finish_text
			pending_text = { k, i, comment_at: out.length - 1, og: is_c ? 'c' : 't' };
			continue;
		}
		if (tok.t === 'start') {
			const name = tok.name;
			const implied = implied_close(stack, name);
			const drop = implied === DROP;
			const close = drop ? -1 : implied;
			const parent = stack[stack.length - 1];
			const has_og = og_in(tok.start, tok.end);
			const head_attr = head_in(tok.start, tok.end);
			const attrs =
				has_og || head_attr || close !== -1
					? parse_attrs(html, tok.name_end)
					: (NO_ATTRS as Attr[]);
			// a head asset in a document's body: lifted into the head (deduped by key)
			if (doc && head_attr && !has_og) {
				const key = attrs.find((a) => a.name === OG_HEAD)?.value;
				if (key !== undefined && (name === 'style' || name === 'link' || name === 'template')) {
					out.push(html.slice(pos, tok.start));
					pos = tok.start;
					if (name === 'link' || tok.self) {
						pos = tok.end;
						if (!head_keys.has(key)) {
							head_keys.add(key);
							head.push(html.slice(tok.start, tok.end));
						}
					} else head_cut = { start: tok.start, name, depth: 1, key };
					continue;
				}
			}
			const og_c = has_og ? attrs.find((a) => a.name === 'og-c') : undefined;
			const og_h = has_og ? attrs.find((a) => a.name === 'og-h' || a.name === 'og-u') : undefined;
			const og_s = has_og && attrs.some((a) => a.name === 'og-s');
			const foreign = name === 'svg' || name === 'math' || !!parent?.foreign;
			const is_host = !!og_h;
			// the render introduced this element: inside a host, not a tagged child, or inherited
			let introduced = false;
			if (parent && !og_c && !og_s) introduced = parent.host !== -1 || parent.introduced;
			// a start tag the parser would restructure, where the render made either side of it
			let stand_in = false;
			if ((close !== -1 || drop) && !foreign) {
				const trigger = close !== -1 ? stack[close] : undefined;
				if (introduced || trigger?.introduced || (drop && introduced)) stand_in = true;
			}
			if (!stand_in) {
				if (close !== -1) cut(stack, close);
				if (drop) continue;
			}
			// the rewrite (a tag without ogygia's marks has nothing to remove: no Set made for it)
			const remove = has_og ? new Set<string>() : NO_REMOVE;
			if (og_s) remove.add('og-s');
			let add = '';
			// ONE attribute reset per element: a planned host's own (it honours og-keep) wins over its
			// reset as a tagged child of the host above (the same attributes, without og-keep)
			let reset: Record<string, string | null> | null = null;
			let planned_host = false;
			if (og_h) {
				const k = Number(og_h.value);
				if (og_h.name === 'og-u' || !plan.has(k)) {
					remove.add(og_h.name);
					remove.add('og-shadow');
					remove.add('og-keep');
				} else {
					planned_host = true;
					const keep = new Set(
						(attrs.find((a) => a.name === 'og-keep')?.value ?? '').split(' ').filter(Boolean)
					);
					reset = attr_diff(attrs, record.hosts.get(k)?.attrs ?? {}, keep);
				}
			}
			if (og_c) {
				const dot = og_c.value.indexOf('.');
				const k = Number(og_c.value.slice(0, dot));
				if (!plan.has(k)) remove.add('og-c');
				// (a tagged child that is itself a host ogygia won't restore is server markup: its own runtime
				// adopts it by the attributes the render gave it — they are not Svelte's to reset)
				else if (!planned_host && og_h?.name !== 'og-u') {
					const was =
						record.hosts.get(k)?.children.get(Number(og_c.value.slice(dot + 1)))?.attrs ?? {};
					reset = attr_diff(attrs, was, new Set());
				}
			}
			if (reset) add = `${add} og-r="${escape_amp_quot(JSON.stringify(reset))}"`;
			if (stand_in) {
				add = `${add} tag="${name}"`;
				stand_ins++;
			}
			if (remove.size || add || stand_in) {
				out.push(
					html.slice(pos, tok.start),
					rewrite_start(html, tok, attrs, remove, add, stand_in ? 'og-as' : undefined)
				);
				pos = tok.end;
			}
			const is_void = VOID.has(name) || (tok.self && foreign);
			if (!is_void)
				push(stack, {
					name: stand_in ? 'og-as' : name,
					as: stand_in ? name : undefined,
					host: is_host ? Number(og_h!.value) : -1,
					next: 0,
					owned: false,
					under: -1,
					introduced,
					foreign
				});
			continue;
		}
		if (tok.t === 'end') {
			const name = tok.name;
			// the end tag of a stand-in becomes `</og-as>`
			for (let k = stack.length - 1; k >= 0; k--) {
				const f = stack[k];
				if ((f.as ?? f.name) === name) {
					if (f.as) {
						out.push(html.slice(pos, tok.start), '</og-as>');
						pos = tok.end;
					}
					cut(stack, k);
					break;
				}
			}
			continue;
		}
	}
	if (pending_text) finish_text(null);
	out.push(html.slice(pos));
	// dev: every planned host's original children (restored exactly, so the browser can compare)
	let check: Record<string, string> | undefined;
	if (opts.dev) {
		for (const k of plan) {
			const rec = record.hosts.get(k);
			if (rec && rec.planned)
				(check ??= {})[k] = record.source.slice(rec.inner_start, rec.inner_end);
		}
	}
	return { html: out.join(''), planned: plan.size, stand_ins, head, ...(check ? { check } : {}) };
}

/** The dev check's payload: each planned Svelte-owned host's original children, by its id. */
export function check_script(check: Record<string, string>): string {
	return `<script type="application/ogygia-restore-check">${script_json(check)}</script>`;
}

/** The host id right after `at` (digits), and where they end. */
function read_id(s: string, at: number): { id: number; end: number } | null {
	let n = 0;
	let j = at;
	while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57)
		n = n * 10 + (s.charCodeAt(j++) - 48);
	return j === at ? null : { id: n, end: j };
}

/** Rewrite every host id in ogygia's marks through `map` (ids it lacks stay). */
export function remap(html: string, map: (id: number) => number | undefined): string {
	if (html.indexOf('og-') === -1) return html;
	const parts: string[] = [];
	let pos = 0;
	const move = (at: number) => {
		const r = read_id(html, at);
		if (!r) return;
		const to = map(r.id);
		if (to === undefined || to === r.id) return;
		parts.push(html.slice(pos, at), String(to));
		pos = r.end;
	};
	for (const at = new MarkupCursor(html); at.next();) {
		if (at.kind === 1)
			visit_attrs(html, at.ne, (ns, ne, vs, _ve, vq) => {
				if (vq !== -1 && ne - ns === 4 && is_id_mark(html, ns)) move(vs);
			});
		else if (at.kind !== 0 && at.kind !== 2 && is_id_comment(html, at.start)) move(at.start + 9);
	}
	if (pos === 0) return html;
	parts.push(html.slice(pos));
	return parts.join('');
}

function is_id_mark(html: string, at: number): boolean {
	if ((html.charCodeAt(at) | 32) !== 111 || (html.charCodeAt(at + 1) | 32) !== 103) return false;
	if (html.charCodeAt(at + 2) !== 45) return false;
	const c = html.charCodeAt(at + 3) | 32;
	return c === 104 || c === 117 || c === 99;
}

function is_id_comment(html: string, at: number): boolean {
	return html.startsWith('<!--og-c ', at) || html.startsWith('<!--og-t ', at);
}

/** The value of the attribute `name` on the start tag `html` opens with, and its span. */
export function root_attr(
	html: string,
	name: string
): { start: number; end: number; value: string } | null {
	const at = new MarkupCursor(html);
	if (!at.next() || at.kind !== 1) return null;
	let found: { start: number; end: number; value: string } | null = null;
	visit_attrs(html, at.ne, (ns, ne, vs, ve, vq) => {
		if (found !== null || html.slice(ns, ne).toLowerCase() !== name) return;
		let end = ne;
		if (vq !== -1) end = vq === 0 ? ve : ve + 1;
		found = {
			start: ns,
			end,
			value: vq === -1 ? '' : html.slice(vs, ve)
		};
	});
	return found;
}

/** An element's marks renumbered from 0 in order of appearance, so the same element has the same
 *  bytes wherever it sits; `back` puts the ids it had on whatever a render returns. */
export class LocalMarks {
	readonly html: string;
	readonly #to_doc: Map<number, number> | null = null;

	constructor(html: string) {
		const to_local = new Map<number, number>();
		let moved = false;
		const local = remap(html, (id) => {
			let l = to_local.get(id);
			if (l === undefined) to_local.set(id, (l = to_local.size));
			if (l !== id) moved = true;
			return l;
		});
		if (!moved) {
			this.html = html;
			return;
		}
		const to_doc = new Map<number, number>();
		for (const [d, l] of to_local) to_doc.set(l, d);
		this.html = local;
		this.#to_doc = to_doc;
	}

	back(rendered: string): string {
		const to_doc = this.#to_doc;
		return to_doc === null ? rendered : remap(rendered, (id) => to_doc.get(id));
	}
}

/** The ids of the hosts ogygia restores (`og-h`) in `html`, quoted any way a serializer writes them. */
export function restored_ids(html: string): Set<number> {
	const out = new Set<number>();
	if (html.indexOf('og-') === -1) return out;
	for (const at = new MarkupCursor(html); at.next();)
		if (at.kind === 1)
			visit_attrs(html, at.ne, (ns, ne, vs, _ve, vq) => {
				if (vq === -1 || ne - ns !== 4 || !is_id_mark(html, ns)) return;
				if ((html.charCodeAt(ns + 3) | 32) !== 104) return;
				const r = read_id(html, vs);
				if (r) out.add(r.id);
			});
	return out;
}

/**
 * The whole server round trip for one piece of markup: mark → the app's transform → settle. Kit-free
 * (exported from `@ogygia/rewrite` for tests that harvest markup and run a transform over it).
 */
export async function transformMarkup(
	html: string,
	transform: (html: string) => string | Promise<string>,
	opts: { kind?: TransformKind; csr?: boolean; dev?: boolean } = {}
): Promise<Settled> {
	const kind = opts.kind ?? 'region';
	const marked = mark(html, kind, !!opts.csr);
	if (!marked) {
		const out = await transform(html);
		return { html: out, planned: 0, stand_ins: 0, head: [] };
	}
	return settle(await transform(marked.html), marked.record, { dev: opts.dev });
}
