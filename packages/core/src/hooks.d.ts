import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from './kit-handle.ts';
import { type TransformKind } from './server/reversible.ts';
/**
 * Options for {@link handle}.
 */
export interface OgygiaHandleOptions {
    /**
     * Path (relative to Kit `base`) of the islands endpoint: the handle answers on it, and every hole
     * and live region on a page is minted against it. Default `/__ogygia__`. Must start with `/`.
     *
     * It must be a path your deployment forwards to the app (behind a proxy that forwards only known
     * prefixes, pick one under them, e.g. `/_server/api/__ogygia__`). Not under Kit's `appDir`
     * (`/_app/…`): Kit answers those itself, before any handle runs.
     */
    endpoint?: string;
    /**
     * The secret that signs region capabilities (hole and live-region URLs). Takes precedence over
     * the `OGYGIA_SECRET` environment variable, for a host whose server process never sees its
     * runtime env. Pass a build-time private env value:
     *
     * ```ts
     * import { OGYGIA_SECRET } from '$env/static/private';
     * export const handle = ogygia.handle({ secret: OGYGIA_SECRET });
     * ```
     *
     * An empty or blank value counts as not given (`OGYGIA_SECRET`, then a per-build random key, sign
     * instead). It signs exactly as the same value in `OGYGIA_SECRET` does, so pages from either
     * verify on the other. In production it needs ≥16 UTF-8 bytes. Every deployment that serves your
     * pages or your islands endpoint needs the same secret.
     */
    secret?: string;
    /**
     * Post-process the HTML ogygia sends — every document (the chunk carrying `</head>`; a streamed
     * tail passes untouched) and every region answer (a hole, a lake remount) — e.g. a web-component
     * server render. `html` in, `html` out, may be async; it is on the response path, so keep it fast.
     *
     * It may reshape Svelte-owned markup. ogygia marks the HTML before the call and restores in the
     * browser, before anything hydrates, what the transform moved:
     * - a custom element marked `og-h` is one ogygia restores (in Svelte-owned markup, above it, or in
     *   a region answer). To reshape it, render its plan: its slot positions as `<slot>` elements
     *   wrapping the moved children, `og-shadow="key …"` (the keyed sheets for its shadow root), and
     *   optionally `og-keep="attr …"` (attributes you added that survive the restore; never per-render
     *   state). One without `og-shadow` is left exactly as Svelte wrote it.
     * - `<template data-og-head="key">css</template>` is a shadow sheet; `<style>` / `<link>` with
     *   `data-og-head="key"` apply to the page. Both go into `<head>`, once per key.
     * - everything else `og-*` is ogygia's: carry it along wherever you move a node; it is gone from
     *   the final DOM.
     */
    transform?: (html: string, ctx: {
        kind: TransformKind;
        csr: boolean;
        event: RequestEvent;
    }) => string | Promise<string>;
}
/**
 * Build a Kit `handle` that serves signed deferred-region / lake-remount HTML and injects page
 * seeds for island hydration. Server-only.
 *
 * ```ts
 * // src/hooks.server.ts
 * import * as ogygia from 'ogygia/server';
 * export const handle = ogygia.handle();
 * ```
 *
 * @param options - Optional endpoint path override. See {@link OgygiaHandleOptions}.
 * @returns A SvelteKit {@link Handle} suitable for `sequence(ogygia.handle(), …)`.
 */
export { ogygiaTransport as transport } from './transport.ts';
export { document, type DocumentOptions } from './document.ts';
export { scanRegions, liftRegions, restoreRegions, type RegionSpan, type RegionKind, type LiftedRegion, type LiftResult } from './server/split-regions.ts';
export declare function handle(options?: OgygiaHandleOptions): Handle;
