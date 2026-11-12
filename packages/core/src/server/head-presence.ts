import { RESPONSE_MARK } from '../contract/response-mark.ts';
import {
	Needle,
	next_tag,
	OG_ORIGINS,
	OGYGIA_DEV_HMR,
	OGYGIA_RUNTIME,
	OGYGIA_RUNTIME_DEP,
	type FoundTag
} from '../wire-markup.ts';

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

/** Does the page carry a real `<meta name="ogygia-router" …>` element (any letter case)? An
 *  HTML-escaped copy in prose (`&lt;meta …`, a page that documents the tag) is not one. */
export function page_declares_router_meta(html: string): boolean {
	return has_tag(html, 'meta', 'ogygia-router', (t) => t.attr('name') === 'ogygia-router');
}

/** Does the page carry a real runtime bootstrap `<script … data-ogygia-runtime …>`? Only the
 *  opening tag counts: an escaped copy in prose, or an inline script whose body names the
 *  attribute, is not one. Any letter case. */
export function page_declares_runtime_script(html: string): boolean {
	return has_tag(html, 'script', RUNTIME_NEEDLE_G, is_runtime);
}

const is_runtime = (t: FoundTag) => t.attr(OGYGIA_RUNTIME) !== undefined;
const is_modulepreload = (t: FoundTag) => MODULEPRELOAD_TOKEN.test(t.attr('rel') ?? '');

/** Does the page carry a real dev-HMR `<script … data-ogygia-dev-hmr …>` (not an escaped copy in
 *  prose)? Any letter case. */
export function page_declares_dev_hmr_script(html: string): boolean {
	return has_tag(html, 'script', DEV_HMR_NEEDLE_G, (t) => t.attr(OGYGIA_DEV_HMR) !== undefined);
}

/** Does the page author its own `<script type="speculationrules" …>` (not an escaped copy in
 *  prose)? The type reads as a browser reads it: spaces around it trimmed, in any case. */
export function page_declares_speculation_rules(html: string): boolean {
	return has_tag(html, 'script', SPECULATION_NEEDLE_G, (t) =>
		SPECULATION_TYPE.test(t.attr('type') ?? '')
	);
}

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

const HEAD_CLOSE_G = /<\/head\s*>/gi;

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
	const found = runtime_unit(head);
	const was = found ? head.slice(found.start, found.end) : runtime;
	if (was === null) return head;
	const placed = with_code_origins(was, code_origins);
	// @why a repeated attribute keeps its first value, so the response's mark leads the tag's attributes (test: test/head-presence.test.ts › leads the attributes, so a mark the markup put on the tag loses)
	const tag = mark ? '<script ' + RESPONSE_MARK + '="' + mark + '"' + placed.slice(7) : placed;
	const rest = found ? head.slice(0, found.start) + head.slice(found.end) : head;
	const from = next_tag(rest, 'head', 0)?.end ?? 0;
	let at = next_tag(rest, 'script', from)?.start ?? Infinity;
	const hint = find_tag(rest, 'link', MODULEPRELOAD_NEEDLE_G, is_modulepreload, from);
	if (hint !== null && hint.start < at) at = hint.start;
	if (at === Infinity) {
		HEAD_CLOSE_G.lastIndex = from;
		at = HEAD_CLOSE_G.exec(rest)?.index ?? rest.length;
	}
	if (found && found.start === at && tag === was) return head;
	return rest.slice(0, at) + tag + rest.slice(at);
}

const CODE_ORIGINS_ATTR_RE = new RegExp(`\\s${OG_ORIGINS}="[^"]*"`, 'i');
const RUNTIME_MARK_RE = new RegExp(`\\b${OGYGIA_RUNTIME}\\b`, 'i');

function with_code_origins(tag: string, urls: readonly string[]): string {
	// @why the one write of `data-og-origins` is at head time, when the render has learned all it will, in place of any the tag carried (test: test/code-origins.test.ts › a runtime script the page emitted gets them too, in place of any it carried)
	const origins = new Set<string>();
	for (const url of urls) {
		try {
			const u = new URL(url);
			if (u.protocol === 'https:' || u.protocol === 'http:') origins.add(u.origin);
		} catch {
			// ok: not a URL: no origin to allow
		}
	}
	const bare = tag.replace(CODE_ORIGINS_ATTR_RE, '');
	if (!origins.size) return bare;
	return bare.replace(
		RUNTIME_MARK_RE,
		(mark) => mark + ` ${OG_ORIGINS}="` + [...origins].join(' ') + '"'
	);
}
