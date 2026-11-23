import { RESPONSE_MARK } from '../contract/response-mark.ts';
import {
	attr_spans,
	read_head_tag,
	read_tag,
	OG_ORIGINS,
	OGYGIA_DEV_HMR,
	OGYGIA_RUNTIME,
	OGYGIA_RUNTIME_DEP,
	type FoundTag,
	type HeadTagList,
	type HeadTagName
} from '../wire-markup.ts';

const RUNTIME_NEEDLE_G = new RegExp(OGYGIA_RUNTIME, 'gi');
const DEV_HMR_NEEDLE_G = new RegExp(OGYGIA_DEV_HMR, 'gi');
const SPECULATION_NEEDLE_G = /speculationrules/gi;
const MODULEPRELOAD_NEEDLE_G = /modulepreload/gi;
const MODULEPRELOAD_TOKEN = /(?:^|[\t\n\f\r ])modulepreload(?:[\t\n\f\r ]|$)/i;
const SPECULATION_TYPE = /^[\t\n\f\r ]*speculationrules[\t\n\f\r ]*$/i;
const HEAD_CLOSE_G = /<\/head\s*>/gi;

const is_runtime = (t: FoundTag) => t.attr(OGYGIA_RUNTIME) !== undefined;
const is_modulepreload = (t: FoundTag) => MODULEPRELOAD_TOKEN.test(t.attr('rel') ?? '');
const is_router_meta = (t: FoundTag) => t.attr('name') === 'ogygia-router';
const is_dev_hmr = (t: FoundTag) => t.attr(OGYGIA_DEV_HMR) !== undefined;
const is_speculation = (t: FoundTag) => SPECULATION_TYPE.test(t.attr('type') ?? '');

function holds(html: string, needle: string | RegExp): boolean {
	return typeof needle === 'string' ? html.includes(needle) : html.search(needle) !== -1;
}

/**
 * A page's head, read once: its `head`, `script`, `link` and `meta` start tags in order, each read
 * the way a browser reads it (markup-walk.ts `read_head`). Every question the page transform asks
 * of the head (the presence checks, the link dedupe, where the runtime goes) is a look through
 * these tags, never another walk of the text. A cut (a dropped link, the runtime moved) keeps the
 * tags it did not touch, at their new places: a cut changes how the text around it reads only
 * when the text before it ends in a bare `<` (that `<` and the text after the cut could open a
 * tag), and then the rest is read again.
 */
export class HeadTags {
	readonly html: string;
	readonly #tags: FoundTag[];
	readonly #names: HeadTagName[];
	/** Where the walk goes on from for more tags (-1: every tag is read). */
	#cursor: number;
	/** How far each tag moved back in `html` since it was read (null: none moved). */
	readonly #moved: number[] | null;

	/** `html`'s tags: `read` when the walk that found `html`'s end kept them (`read_head` over the
	 *  document `html` is the front of), else read as far as each question needs. */
	constructor(html: string, read: HeadTagList | null = null, moved: number[] | null = null) {
		this.html = html;
		this.#tags = read === null ? [] : read.tags;
		this.#names = read === null ? [] : read.names;
		this.#cursor = read === null ? 0 : -1;
		this.#moved = moved;
	}

	/** One more tag read: false when there is none. */
	#more(): boolean {
		if (this.#cursor === -1) return false;
		const had = this.#tags.length;
		this.#cursor = read_head_tag(this.html, this.#cursor, { tags: this.#tags, names: this.#names });
		return this.#tags.length !== had;
	}

	#all(): FoundTag[] {
		while (this.#more());
		return this.#tags;
	}

	#start(i: number): number {
		return this.#tags[i]!.start - (this.#moved === null ? 0 : this.#moved[i]!);
	}

	#end(i: number): number {
		return this.#tags[i]!.end - (this.#moved === null ? 0 : this.#moved[i]!);
	}

	/** The first tag named `name` at or after `from` for which `test` holds, or -1. */
	#find(name: HeadTagName, from: number, test: ((t: FoundTag) => boolean) | null = null): number {
		const tags = this.#tags;
		const names = this.#names;
		for (let i = 0; i < tags.length || this.#more(); i++)
			if (names[i] === name && this.#start(i) >= from && (test === null || test(tags[i]!)))
				return i;
		return -1;
	}

	#declares(name: HeadTagName, needle: string | RegExp, test: (t: FoundTag) => boolean): boolean {
		return holds(this.html, needle) && this.#find(name, 0, test) !== -1;
	}

	/** A real `<meta name="ogygia-router" …>` (any letter case; an escaped copy in prose is none). */
	declares_router_meta(): boolean {
		return this.#declares('meta', 'ogygia-router', is_router_meta);
	}

	/** A real runtime bootstrap `<script … data-ogygia-runtime …>`: only the opening tag counts, not
	 *  an escaped copy in prose or an inline script whose body names the attribute. Any case. */
	declares_runtime_script(): boolean {
		return this.#declares('script', RUNTIME_NEEDLE_G, is_runtime);
	}

	/** A real dev-HMR `<script … data-ogygia-dev-hmr …>`. Any case. */
	declares_dev_hmr_script(): boolean {
		return this.#declares('script', DEV_HMR_NEEDLE_G, is_dev_hmr);
	}

	/** The page's own `<script type="speculationrules" …>`: the type read as a browser reads it
	 *  (spaces around it trimmed, any case). */
	declares_speculation_rules(): boolean {
		return this.#declares('script', SPECULATION_NEEDLE_G, is_speculation);
	}

	/** This head with `cuts` (ascending `[start, end)` spans of `html`, each from a tag's `<` to a
	 *  token's end) taken out: `out` is the text left. */
	#without(cuts: ReadonlyArray<readonly [number, number]>, out: string): HeadTags {
		const old = this.#all();
		let gone = 0;
		for (const [start, end] of cuts) {
			if (start - gone > 0 && out.charCodeAt(start - gone - 1) === 60) return new HeadTags(out);
			gone += end - start;
		}
		const tags: FoundTag[] = [];
		const names: HeadTagName[] = [];
		const moved: number[] = [];
		let c = 0;
		gone = 0;
		for (let i = 0; i < old.length; i++) {
			const at = this.#start(i);
			for (; c < cuts.length && cuts[c]![1] <= at; c++) gone += cuts[c]![1] - cuts[c]![0];
			if (c < cuts.length && at >= cuts[c]![0]) continue;
			tags.push(old[i]!);
			names.push(this.#names[i]!);
			moved.push((this.#moved === null ? 0 : this.#moved[i]!) + gone);
		}
		return new HeadTags(out, { tags, names }, moved);
	}

	/**
	 * Drop duplicate `<link>` tags, two families:
	 *
	 *  - `rel="stylesheet"`: same href → first occurrence wins. Kit links a route's client-graph CSS
	 *    and Region.svelte links a rendered island's CSS from the render pass; a layout island
	 *    compiled as a real wrapper (a csr=true-capable layout host) is in both, so its sheet was
	 *    linked twice — two render-blocking fetches of one asset. `<style>` tags are untouched.
	 *  - `rel="modulepreload"`: same href → first occurrence wins. Each island's SSR emits its own
	 *    dep-hint block, so islands sharing dep chunks — or one island rendered N times — repeat
	 *    identical hints (a real page carried ~44 duplicate tags). Every hint ogygia emits is
	 *    `fetchpriority="low"` (Region.svelte), so there is no priority to arbitrate between copies.
	 *
	 * Every other `<link>` passes through byte-identical. Returns this head when nothing repeats.
	 */
	deduped(): HeadTags {
		const tags = this.#all();
		const names = this.#names;
		const html = this.html;
		const sheets = new Set<string>();
		const hints = new Set<string>();
		let cuts: Array<[number, number]> | null = null;
		for (let i = 0; i < tags.length; i++) {
			if (names[i] !== 'link') continue;
			const t = tags[i]!;
			const rel = t.attr('rel');
			let seen = sheets;
			if (rel === 'modulepreload') seen = hints;
			else if (rel !== 'stylesheet') continue;
			const href = t.attr('href');
			if (href === undefined) continue;
			if (!seen.has(href)) {
				seen.add(href);
				continue;
			}
			(cuts ??= []).push([this.#start(i), this.#end(i)]);
		}
		if (cuts === null) return this;
		const out: string[] = [];
		let kept = 0;
		for (const [start, end] of cuts) {
			out.push(html.slice(kept, start));
			kept = end;
		}
		out.push(html.slice(kept));
		return this.#without(cuts, out.join(''));
	}

	/** The runtime bootstrap with the hints that follow it (`data-ogygia-runtime-dep`), or null. */
	#runtime_unit(): { start: number; end: number } | null {
		if (!holds(this.html, RUNTIME_NEEDLE_G)) return null;
		const i = this.#find('script', 0, is_runtime);
		if (i === -1) return null;
		const html = this.html;
		const script_end = this.#end(i);
		if (!html.startsWith('</script>', script_end)) return null;
		const start = this.#start(i);
		let end = script_end + '</script>'.length;
		for (;;) {
			const dep = this.#find('link', end);
			if (
				dep === -1 ||
				this.#start(dep) !== end ||
				this.#tags[dep]!.attr(OGYGIA_RUNTIME_DEP) === undefined
			)
				break;
			end = this.#end(dep);
		}
		return { start, end };
	}

	/** `runtime_first` (below) on this head. */
	runtime_first(runtime: string | null, code_origins: readonly string[] = [], mark = ''): string {
		const head = this.html;
		const found = this.#runtime_unit();
		const was = found ? head.slice(found.start, found.end) : runtime;
		if (was === null) return head;
		const placed = with_code_origins(was, code_origins);
		// @why a repeated attribute keeps its first value, so the response's mark leads the tag's attributes (test: test/head-presence.test.ts › leads the attributes, so a mark the markup put on the tag loses)
		const tag = mark ? `<script ${RESPONSE_MARK}="${mark}"${placed.slice(7)}` : placed;
		const rest = found
			? this.#without(
					[[found.start, found.end]],
					head.slice(0, found.start) + head.slice(found.end)
				)
			: this;
		const r = rest.html;
		const open = rest.#find('head', 0);
		const from = open === -1 ? 0 : rest.#end(open);
		const script = rest.#find('script', from);
		let at = script === -1 ? Infinity : rest.#start(script);
		const hint = holds(r, MODULEPRELOAD_NEEDLE_G) ? rest.#find('link', from, is_modulepreload) : -1;
		if (hint !== -1 && rest.#start(hint) < at) at = rest.#start(hint);
		if (at === Infinity) {
			HEAD_CLOSE_G.lastIndex = from;
			at = HEAD_CLOSE_G.exec(r)?.index ?? r.length;
		}
		if (found && found.start === at && tag === was) return head;
		return r.slice(0, at) + tag + r.slice(at);
	}
}

/** Does the page carry a real `<meta name="ogygia-router" …>` element (any letter case)? An
 *  HTML-escaped copy in prose (`&lt;meta …`, a page that documents the tag) is not one. */
export function page_declares_router_meta(html: string): boolean {
	return new HeadTags(html).declares_router_meta();
}

/** Does the page carry a real runtime bootstrap `<script … data-ogygia-runtime …>`? Only the
 *  opening tag counts: an escaped copy in prose, or an inline script whose body names the
 *  attribute, is not one. Any letter case. */
export function page_declares_runtime_script(html: string): boolean {
	return new HeadTags(html).declares_runtime_script();
}

/** Does the page carry a real dev-HMR `<script … data-ogygia-dev-hmr …>` (not an escaped copy in
 *  prose)? Any letter case. */
export function page_declares_dev_hmr_script(html: string): boolean {
	return new HeadTags(html).declares_dev_hmr_script();
}

/** Does the page author its own `<script type="speculationrules" …>` (not an escaped copy in
 *  prose)? The type reads as a browser reads it: spaces around it trimmed, in any case. */
export function page_declares_speculation_rules(html: string): boolean {
	return new HeadTags(html).declares_speculation_rules();
}

/** Drop duplicate `<link>` tags in the HEAD (`HeadTags.deduped`). The handle runs it on the HEAD
 *  SLICE of the document only (everything before `</head>`, tens of KB): the hints and the sheets
 *  live there, so the 2.6 MB body is never scanned for them. */
export function dedupe_head_links(head: string): string {
	return new HeadTags(head).deduped().html;
}

/**
 * Put the runtime bootstrap BEFORE ALL OF THE PAGE'S JAVASCRIPT in `<head>` — immediately ahead of
 * the first `<script>` or `<link rel="modulepreload">` the app's template and the page carry, and
 * no earlier. `runtime` is the tag to place when the head has none yet (`null` = only reorder what
 * is there; the tag an island page emits sits wherever Kit's head slot is, after the app's own
 * scripts in `app.html`). The modulepreload hints that follow the tag (`data-ogygia-runtime-dep`)
 * move with it, as one unit. The search starts after `<head …>`; a slice with no `<head>` (a
 * routeless document's inner head) is searched whole, and a modulepreload hint counts only when it
 * comes before the first script. With no JavaScript in the head it goes last in it, before
 * `</head>`. Returns `head` itself when there is nothing to move. `mark`: the response's mark,
 * written on the tag it places (the one every side channel of the response bears: RESPONSE-MARK).
 *
 * Why BEFORE THE JS: module and deferred scripts run in document order once parsing ends, and the
 * runtime's custom-element definition is what makes every `<ogygia-region>` connect and keep its
 * server markup — the copy an island hydrates against when something edited it while it slept
 * (runtime/core.ts `#ssr_html`). A design-system runtime loaded from the app template ran BEFORE the
 * runtime on a customer page and stripped the whitespace nodes of every island in the header before
 * the runtime ever saw them, so the "server copy" was the edited DOM and the login island still
 * re-rendered client-side on its first tap. Ahead of every script, the runtime sees the document as
 * the server sent it, whatever the app loads after it.
 *
 * Why NOT FIRST IN THE HEAD: that ordering guarantee is about execution, and only needs "before the
 * other scripts". Heading the whole `<head>` also made the runtime the page's FIRST REQUEST, ahead of
 * its stylesheets and its LCP image preload. Everything that is not JavaScript — the charset and
 * other `<meta>`, the `<title>`, stylesheets, preconnects, image/font preloads — keeps its place in
 * front of it.
 */
export function runtime_first(
	head: string,
	runtime: string | null,
	code_origins: readonly string[] = [],
	mark = ''
): string {
	return new HeadTags(head).runtime_first(runtime, code_origins, mark);
}

function with_code_origins(tag: string, urls: readonly string[]): string {
	// @why the one write of `data-og-origins` is at head time, when the render has learned all it will, in place of any the tag carried (test: test/code-origins.test.ts › a runtime script the page emitted gets them too, in place of any it carried)
	const origins = new Set<string>();
	for (const url of urls) {
		try {
			const u = new URL(url);
			if (u.protocol === 'https:' || u.protocol === 'http:') origins.add(u.origin);
			// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL: no origin to allow
		} catch {}
	}
	const bare = without_attr(tag, OG_ORIGINS);
	if (!origins.size) return bare;
	const script = read_tag(bare, 0, SCRIPT_OPEN.length);
	const at = script === null ? undefined : attr_spans(bare, script, 'script', OGYGIA_RUNTIME)[0];
	if (at === undefined) return bare;
	return `${bare.slice(0, at[1])} ${OG_ORIGINS}="${[...origins].join(' ')}"${bare.slice(at[1])}`;
}

const SCRIPT_OPEN = '<script';

/** `unit` (a `<script …>` tag first) with every copy of its start tag's attribute `attr` cut. */
function without_attr(unit: string, attr: string): string {
	const script = read_tag(unit, 0, SCRIPT_OPEN.length);
	if (script === null) return unit;
	let out = '';
	let from = 0;
	for (const [start, end] of attr_spans(unit, script, 'script', attr)) {
		out += unit.slice(from, start);
		from = end;
	}
	return from === 0 ? unit : out + unit.slice(from);
}
