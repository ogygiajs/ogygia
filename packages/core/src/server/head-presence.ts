import { is_word } from './html-scan.ts';

const ROUTER_META_RE = /<meta\b[^>]*\bname=["']ogygia-router["']/i;
const RUNTIME_SCRIPT_RE = /<script\b[^>]*\bdata-ogygia-runtime\b/i;
const DEV_HMR_SCRIPT_RE = /<script\b[^>]*\bdata-ogygia-dev-hmr\b/i;
const SPECULATION_RULES_RE = /<script\b[^>]*\btype=["']speculationrules["']/i;

/** Does the page carry a real `<meta name="ogygia-router" …>` element (any letter case)? An
 *  HTML-escaped copy in prose (`&lt;meta …`, a page that documents the tag) is not one. */
export function page_declares_router_meta(html: string): boolean {
	return ROUTER_META_RE.test(html);
}

/** Does the page carry a real runtime bootstrap `<script … data-ogygia-runtime …>`? Only the
 *  opening tag counts: an escaped copy in prose, or an inline script whose body names the
 *  attribute, is not one. Any letter case. */
export function page_declares_runtime_script(html: string): boolean {
	return RUNTIME_SCRIPT_RE.test(html);
}

/** Does the page carry a real dev-HMR `<script … data-ogygia-dev-hmr …>` (not an escaped copy in
 *  prose)? Any letter case. */
export function page_declares_dev_hmr_script(html: string): boolean {
	return DEV_HMR_SCRIPT_RE.test(html);
}

/** Does the page author its own `<script type="speculationrules" …>` (not an escaped copy in
 *  prose)? Any letter case. */
export function page_declares_speculation_rules(html: string): boolean {
	return SPECULATION_RULES_RE.test(html);
}

function quoted_attr(s: string, from: number, to: number, attr: string): string | undefined {
	const n = attr.length;
	for (let i = s.indexOf(attr, from); i !== -1 && i + n + 2 <= to; i = s.indexOf(attr, i + 1)) {
		if (is_word(s.charCodeAt(i - 1)) || s.charCodeAt(i + n) !== 61) continue;
		const q = s.charCodeAt(i + n + 1);
		if (q !== 34 && q !== 39) continue;
		const start = i + n + 2;
		let end = start;
		for (; end < to; end++) {
			const c = s.charCodeAt(end);
			if (c === 34 || c === 39) return s.slice(start, end);
		}
	}
	return undefined;
}

/**
 * Drop duplicate `<link>` tags in the HEAD — one pass over the head slice, two families:
 *
 *  - `rel="stylesheet"`: same href → first occurrence wins. Kit links a route's client-graph CSS
 *    and Region.svelte links a rendered island's CSS from the render pass; a layout island compiled
 *    as a real wrapper (a csr=true-capable layout host) is in both, so its sheet was linked twice —
 *    two render-blocking fetches of one asset. `<style>` tags are untouched.
 *  - `rel="modulepreload"`: same href → first occurrence wins. Each island's SSR emits its own
 *    dep-hint block, so islands sharing dep chunks — or one island rendered N times — repeat
 *    identical hints (a real page carried ~44 duplicate tags). Every hint ogygia emits is
 *    `fetchpriority="low"` (Region.svelte), so there is no priority to arbitrate between copies.
 *
 * Every other `<link>` passes through byte-identical. The handle calls this on the HEAD SLICE of
 * the document only (everything before `</head>`, tens of KB): the hints and the sheets live there,
 * so the 2.6 MB body is never scanned for them.
 *
 * The scan matches the `<link` tag name whole (not `<linkx`). A `<link` with no `>` after it ends
 * the scan. An attribute is read only as `name=` plus a quote, after a non-word character (#570);
 * a link with no `href` is left alone.
 */
export function dedupe_head_links(head: string): string {
	if (!head.includes('<link')) return head;
	const sheets = new Set<string>();
	const hints = new Set<string>();
	let out: string[] | null = null;
	let kept = 0;
	for (let lt = head.indexOf('<link'), gt = 0; lt !== -1; lt = head.indexOf('<link', gt + 1)) {
		if (is_word(head.charCodeAt(lt + 5))) {
			gt = lt;
			continue;
		}
		gt = head.indexOf('>', lt);
		if (gt === -1) break;
		const from = lt + 5;
		const rel = quoted_attr(head, from, gt, 'rel');
		const seen = rel === 'stylesheet' ? sheets : rel === 'modulepreload' ? hints : null;
		if (seen === null) continue;
		const href = quoted_attr(head, from, gt, 'href');
		if (href === undefined) continue;
		if (!seen.has(href)) {
			seen.add(href);
			continue;
		}
		(out ??= []).push(head.slice(kept, lt));
		kept = gt + 1;
	}
	if (out === null) return head;
	out.push(head.slice(kept));
	return out.join('');
}

const RUNTIME_SCRIPT_ELEMENT_RE =
	/<script\b[^>]*\bdata-ogygia-runtime\b[^>]*><\/script>(?:<link\b[^>]*\bdata-ogygia-runtime-dep\b[^>]*>)*/i;
const HEAD_OPEN_RE = /<head\b[^>]*>/i;
const FIRST_JS_G = /<script\b|<link\b[^>]*\brel=["']?modulepreload\b/gi;
const HEAD_CLOSE_G = /<\/head\s*>/gi;

function search_from(re: RegExp, s: string, from: number): number {
	re.lastIndex = from;
	const m = re.exec(s);
	return m ? m.index : -1;
}

/**
 * Put the runtime bootstrap BEFORE ALL OF THE PAGE'S JAVASCRIPT in `<head>` — immediately ahead of
 * the first `<script>` or `<link rel="modulepreload">` the app's template and the page carry, and
 * no earlier. `runtime` is the tag to place when the head has none yet (`null` = only reorder what
 * is there; the tag an island page emits sits wherever Kit's head slot is, after the app's own
 * scripts in `app.html`). The modulepreload hints that follow the tag (`data-ogygia-runtime-dep`)
 * move with it, as one unit. The search starts after `<head …>`; a slice with no `<head>` (a
 * routeless document's inner head) is searched whole. With no JavaScript in the head it goes last
 * in it, before `</head>`.
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
export function runtime_first(head: string, runtime: string | null): string {
	const found = RUNTIME_SCRIPT_ELEMENT_RE.exec(head);
	const tag = found ? found[0] : runtime;
	if (tag === null) return head;
	const rest = found
		? head.slice(0, found.index) + head.slice(found.index + found[0].length)
		: head;
	const open = HEAD_OPEN_RE.exec(rest);
	const from = open ? open.index + open[0].length : 0;
	let at = search_from(FIRST_JS_G, rest, from);
	if (at === -1) {
		const close = search_from(HEAD_CLOSE_G, rest, from);
		at = close === -1 ? rest.length : close;
	}
	if (found && found.index === at) return head;
	return rest.slice(0, at) + tag + rest.slice(at);
}
