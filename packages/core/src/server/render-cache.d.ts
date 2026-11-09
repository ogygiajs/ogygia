/** What a region render is made from: the region, its props, the visitor's session seal, and (when
 *  its tree reads `page.data`) the page it renders for. */
export type RenderKey = {
    id: string;
    payload: string;
    session: string;
    page: string | null;
};
/** Cache key for a region render — id + props payload + session seal (+ the page, for a tree that
 *  reads `page.data`). `exp`/`sig` (which rotate per mint) and `ttl` (a cache-window declaration,
 *  not a render input) are DELIBERATELY excluded so two renders of the same region+props+user hit;
 *  session is INCLUDED so users never cross. Each part is its own key field, so two calls whose
 *  parts differ never share an entry, whatever the parts hold. */
export declare function render_cache_key(id: string, payload: string, session: string, page?: string | null): RenderKey;
/** Test/ops hook: the HTML kept for `key` now, or null. */
export declare function render_cache_get(key: RenderKey): string | null;
/** Test/ops hook: drop everything, the flights in progress too (what they render is not kept, and
 *  the calls waiting on them render afresh). */
export declare function render_cache_clear(): void;
/**
 * THE shared cache-fronted render (G2) — the ONE seam both the deferred-region endpoint
 * (#render_component) and the inline-island page render (Region.svelte) call. A hit returns the
 * memo; a miss renders via `render_body(signal)` (the caller supplies it — the endpoint wraps its
 * render in a concurrency gate + timeout, the inline path renders directly), then caches. `cache`
 * is `undefined`/`ttl<=0` for a dynamic hole → always renders, never stores.
 */
export declare function cached_render(render_body: (signal?: AbortSignal) => string | null | Promise<string | null>, cache: {
    key: RenderKey;
    ttl: number;
} | undefined, 
/** told what happened (`hit` served without rendering: the memo, or the render in flight it
 *  joined; `miss` rendered + stored; `none` uncached) */
report?: (outcome: 'hit' | 'miss' | 'none') => void, 
/** aborts when this call's request has gone: it leaves the render (a render nobody waits on any
 *  more is stopped), and gives up with the signal's reason */
signal?: AbortSignal): Promise<string | null>;
