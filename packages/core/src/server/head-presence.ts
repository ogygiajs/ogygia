/**
 * Presence checks for the head tags the `handle()` transform injects (the router meta, the runtime
 * bootstrap, the dev-HMR script, MPA speculation rules). Each must detect a REAL element, never the
 * tag's name as TEXT.
 *
 * Why this exists as its own module: a page that DOCUMENTS one of these tags in a code block renders
 * it HTML-escaped — `` `<meta name="ogygia-router" content="plain">` `` becomes
 * `<code>&lt;meta name="ogygia-router" content="plain"></code>`. A substring check like
 * `html.includes('name="ogygia-router"')` false-matches that prose and suppresses the injection; for
 * the router marker that silently drops the whole page to full-page navigation (no marker → the
 * client router hands off to `location.href`, so no SPA and no view transition). The changelog page
 * documents exactly these tags, which is how the bug surfaced.
 *
 * Every check reads real start tags through `tags()` (../wire-markup.ts): the escaped copy carries
 * `&lt;`, never a bare `<`, so it is not a tag; a tag's attributes end at its own `>` (quotes kept),
 * so a `<script>` whose BODY mentions the attribute (inline JS) can't false-match either.
 */
import {
	Needle,
	next_tag,
	OGYGIA_DEV_HMR,
	OGYGIA_RUNTIME,
	OGYGIA_RUNTIME_DEP,
	type FoundTag
} from '../wire-markup.ts';

/** The first `<name …>` from `from` that carries `needle` (wire-markup.ts `Needle`) in a way `test`
 *  accepts, or null. A head without the needle reads no tag. */
function find_tag(
	html: string,
	name: string,
	needle: string | RegExp,
	test: (tag: FoundTag) => boolean,
	from = 0
): FoundTag | null {
	const held = new Needle(html, needle, from);
	if (held.gone) return null;
	for (let t = next_tag(html, name, from); t !== null; t = next_tag(html, name, t.next)) {
		if (held.holds(t) && test(t)) return t;
		if (held.gone) return null;
	}
	return null;
}

function has_tag(
	html: string,
	name: string,
	needle: string | RegExp,
	test: (tag: FoundTag) => boolean
): boolean {
	return find_tag(html, name, needle, test) !== null;
}

/** A real `<meta name="ogygia-router" …>` element — a page opting a route out of view transitions. */
export function page_declares_router_meta(html: string): boolean {
	return has_tag(html, 'meta', 'ogygia-router', (t) => t.attr('name') === 'ogygia-router');
}

/** A real runtime bootstrap `<script … data-ogygia-runtime …>` (Region emits it on island pages). */
export function page_declares_runtime_script(html: string): boolean {
	return has_tag(html, 'script', RUNTIME_NEEDLE_G, is_runtime);
}

const is_runtime = (t: FoundTag) => t.attr(OGYGIA_RUNTIME) !== undefined;
/** A `rel` holding the `modulepreload` token, in any case, as a browser reads it. */
const is_modulepreload = (t: FoundTag) => MODULEPRELOAD_TOKEN.test(t.attr('rel') ?? '');

/** A real dev-HMR `<script … data-ogygia-dev-hmr …>`. */
export function page_declares_dev_hmr_script(html: string): boolean {
	return has_tag(html, 'script', DEV_HMR_NEEDLE_G, (t) => t.attr(OGYGIA_DEV_HMR) !== undefined);
}

/** A real `<script type="speculationrules" …>` (a page authoring its own MPA speculation rules).
 *  The type reads as a browser reads it: spaces around it trimmed, in any case. */
export function page_declares_speculation_rules(html: string): boolean {
	return has_tag(html, 'script', SPECULATION_NEEDLE_G, (t) =>
		SPECULATION_TYPE.test(t.attr('type') ?? '')
	);
}

// The name needles: global so a search starts at a tag (`lastIndex`), case-blind as names are.
const RUNTIME_NEEDLE_G = new RegExp(OGYGIA_RUNTIME, 'gi');
const DEV_HMR_NEEDLE_G = new RegExp(OGYGIA_DEV_HMR, 'gi');
const SPECULATION_NEEDLE_G = /speculationrules/gi;
const MODULEPRELOAD_NEEDLE_G = /modulepreload/gi;
const MODULEPRELOAD_TOKEN = /(?:^|[\t\n\f\r ])modulepreload(?:[\t\n\f\r ]|$)/i;
const SPECULATION_TYPE = /^[\t\n\f\r ]*speculationrules[\t\n\f\r ]*$/i;

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
 */
export function dedupe_head_links(head: string): string {
	let t = next_tag(head, 'link', 0);
	if (t === null) return head;
	const sheets = new Set<string>();
	const hints = new Set<string>();
	// (the kept spans are joined once at the end, and only when a duplicate was dropped)
	let out: string[] | null = null;
	let kept = 0;
	for (; t !== null; t = next_tag(head, 'link', t.next)) {
		const rel = t.attr('rel');
		const seen = rel === 'stylesheet' ? sheets : rel === 'modulepreload' ? hints : null;
		if (seen === null) continue;
		const href = t.attr('href');
		if (href === undefined) continue;
		if (!seen.has(href)) {
			seen.add(href);
			continue;
		}
		(out ??= []).push(head.slice(kept, t.start));
		kept = t.end;
	}
	if (out === null) return head;
	out.push(head.slice(kept));
	return out.join('');
}

// The `</head>` close: an end tag (tags() reads start tags). Global, so a search starts at an offset
// (`lastIndex`) instead of on a sliced copy of the head.
const HEAD_CLOSE_G = /<\/head\s*>/gi;

/**
 * The whole runtime bootstrap element (its `<script … data-ogygia-runtime></script>`) together with
 * the modulepreload hints for its imports that follow it (document-tail.ts `runtime_bootstrap_tags`):
 * they move as one unit. `[start, end)` in `head`, or null.
 */
function runtime_unit(head: string): { start: number; end: number } | null {
	const script = find_tag(head, 'script', RUNTIME_NEEDLE_G, is_runtime);
	if (script === null || !head.startsWith('</script>', script.end)) return null;
	let end = script.end + '</script>'.length;
	for (;;) {
		const dep = next_tag(head, 'link', end);
		if (dep === null || dep.start !== end || dep.attr(OGYGIA_RUNTIME_DEP) === undefined) break;
		end = dep.end;
	}
	return { start: script.start, end };
}

/**
 * Put the runtime bootstrap BEFORE ALL OF THE PAGE'S JAVASCRIPT in `<head>` — immediately ahead of
 * the first `<script>` or `<link rel="modulepreload">` the app's template and the page carry, and
 * no earlier. `runtime` is the tag to place when the head has none yet (`null` = only reorder what
 * is there; the tag an island page emits sits wherever Kit's head slot is, after the app's own
 * scripts in `app.html`). With no JavaScript in the head it goes last in it. Returns `head` itself
 * when there is nothing to move.
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
	const found = runtime_unit(head);
	const tag = found ? head.slice(found.start, found.end) : runtime;
	if (tag === null) return head;
	const rest = found ? head.slice(0, found.start) + head.slice(found.end) : head;
	// no `<head>` in this slice (a routeless document's inner head): search the whole content
	const from = next_tag(rest, 'head', 0)?.end ?? 0;
	let at = next_tag(rest, 'script', from)?.start ?? Infinity;
	// (a modulepreload hint counts only when it comes before that script)
	const hint = find_tag(rest, 'link', MODULEPRELOAD_NEEDLE_G, is_modulepreload, from);
	if (hint !== null && hint.start < at) at = hint.start;
	if (at === Infinity) {
		HEAD_CLOSE_G.lastIndex = from;
		at = HEAD_CLOSE_G.exec(rest)?.index ?? rest.length;
	}
	if (found && found.start === at) return head;
	return rest.slice(0, at) + tag + rest.slice(at);
}
