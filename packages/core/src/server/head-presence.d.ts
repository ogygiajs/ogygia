export declare function page_declares_router_meta(html: string): boolean;
export declare function page_declares_runtime_script(html: string): boolean;
export declare function page_declares_dev_hmr_script(html: string): boolean;
export declare function page_declares_speculation_rules(html: string): boolean;
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
export declare function dedupe_head_links(head: string): string;
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
export declare function runtime_first(head: string, runtime: string | null): string;
