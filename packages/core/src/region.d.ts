/**
 * Held regions — a held render. A value you can pass around and render with `<Region of={f} />`.
 *
 * `region(Component, props)` produces one, props type-checked against the component.
 *
 * One value, three faces the renderer sees:
 * - **inline** — a plain component import. Renders in the current server pass. Cannot cross the wire
 *   (nothing prepared a chunk for it). SDUI composed in place.
 * - **dual** — a component imported `with { region: 'raw' }`. Server-side it holds BOTH the real
 *   component (renders inline, first paint) AND everything needed to sign a capability. Rendered in
 *   the same pass → inline. Serialized to the client → the {@link import('./hooks.ts').ogygiaTransport}
 *   strips the component and signs a ticket, so it arrives as `deferred`.
 * - **deferred** — what a dual region becomes across the wire: a signed ticket the runtime fetches
 *   and (if interactive) hydrates. No component.
 */
import type { Component } from 'svelte';
import { region_snippet } from './region-snippet.ts';
/** Brand so the transport can recognize a region without false-matching plain objects. */
import { REGION_BRAND } from './region-brand.ts';
export { REGION_BRAND };
/** Schedule options for a held region. `wake` = when its JS runs; `margin` = IntersectionObserver
 * rootMargin for `wake: 'visible'`. Merged OVER the binding's baked schedule (from a `wake:` mark) —
 * anything set here WINS; a `region: 'raw'` binding bakes nothing, so this is the whole schedule. */
export type RegionOptions = {
    wake?: string;
    margin?: string;
};
/**
 * The `region()` schedule argument: a function handed the component's own props (its "generated
 * data") that returns the schedule. Always a function, never a bare object — the object case is the
 * baked `wake:` mark on the import. The function is for a registry of `region: 'raw'` components that
 * decides each one's timing from its data — e.g.
 * `region(block, data, (d) => ({ wake: d.interactive ? 'load' : undefined }))`.
 */
export type RegionSchedule<P = Record<string, unknown>> = (data: P) => RegionOptions;
/**
 * The region result types erase the component's prop type — `region()` type-checks props
 * against the component at the call site, so the stored value doesn't need to stay generic. Erasing
 * keeps every concrete region assignable to the bare {@link RegionValue} supertype (a `C` in both a
 * covariant `props` and a contravariant `component` position has no non-`any` supertype otherwise).
 */
type AnyComponent = Component<Record<string, unknown>>;
/** A plain component. Renders in the current server pass; **awaiting** it bakes its SSR HTML so it
 *  can cross the wire as an HTML-only ticket (no chunk, no signer — nothing to fetch). */
export type InlineRegion = {
    readonly [REGION_BRAND]: true;
    readonly kind: 'inline';
    readonly component: AnyComponent;
    readonly props: Record<string, unknown>;
    /** Server-rendered HTML, present once the region has been awaited. What lets an inline region
     *  (a content `body`) travel: the transport ships the markup, the runtime swaps it in and wakes
     *  any islands inside it — the same machinery as body-swap navigation. */
    readonly html?: string;
    /** Content-body CSS key (`content_css_key`) for a `.svx`/`.md` body whose own scoped `<style>`
     *  lives on no page stylesheet — the leak-free corpus is server-only, so its CSS never joins the
     *  page's static import graph. Region.svelte resolves it through the handoff (`contentCss`) and
     *  links the client CSS asset the plugin emitted. Absent for a body with no scoped `<style>`. */
    readonly content_id?: string;
};
/** A marked component: renders inline here, or becomes a signed ticket when it crosses the wire. */
export type DualRegion = {
    readonly [REGION_BRAND]: true;
    readonly kind: 'dual';
    readonly component: AnyComponent;
    readonly props: Record<string, unknown>;
    readonly id: string;
    readonly module: string;
    readonly hydrate?: string;
    readonly hydrateMargin?: string;
    /** Server signer, invoked by the transport at serialization. Never crosses the wire. */
    readonly sign: (id: string, props: Record<string, unknown>) => string;
    /**
     * Server-only renderer, invoked when the region is **awaited** (see {@link region}). Renders
     * the component to HTML on the server so the ticket can travel with its markup — no client fetch.
     * Provided by the SSR region-binding leg; never crosses the wire.
     */
    readonly renderHtml?: (props: Record<string, unknown>) => string | Promise<string>;
    /** Server-rendered HTML, present once the region has been awaited. Rides the wire in the ticket. */
    readonly html?: string;
};
/** A held region that arrived over the wire: a signed capability, no component. */
export type DeferredRegion = {
    readonly [REGION_BRAND]: true;
    readonly kind: 'deferred';
    readonly id: string;
    readonly props: Record<string, unknown>;
    /** Signed `/__ogygia__?id&props&exp&sig` capability the runtime fetches. */
    readonly url: string;
    /** Client hydrate-module URL, imported after the HTML swaps in; `''` for a static region. */
    readonly module: string;
    /** Wake schedule ('load' | 'idle' | 'visible' | media); absent for a static region. */
    readonly hydrate?: string;
    /** IntersectionObserver rootMargin when `hydrate` is `'visible'`. */
    readonly hydrateMargin?: string;
    /**
     * Server-rendered HTML baked into the ticket (the region was awaited before it crossed). When
     * present the runtime swaps it in immediately and morphs across updates — no fetch. Absent → the
     * runtime fetches the signed `url` as usual.
     */
    readonly html?: string;
};
export type RegionValue = InlineRegion | DualRegion | DeferredRegion;
/**
 * What {@link region} returns: a {@link RegionValue} you can render right now with `<Region of={…} />`,
 * AND a `PromiseLike<Region>` you can `await` to bake its server-rendered HTML into the ticket. In an
 * async generator (`query.live`) or async remote, `yield` / `return` awaits it for you.
 */
export type AwaitableRegion = RegionValue & PromiseLike<RegionValue>;
/** True for any value produced by {@link region} (or decoded from the wire). */
export declare function isRegion(value: unknown): value is RegionValue;
/** `region()` itself; the export below adds `region.snippet`. */
declare function make_region<P extends Record<string, unknown>>(component: Component<P>, props: P, opts?: RegionSchedule<P>, 
/** Internal: content-body CSS key, set by the markdown source (see {@link InlineRegion.content_id}). */
content_id?: string): AwaitableRegion;
/**
 * INTERNAL (content formats): an inline region whose SSR HTML is already known — a serialized-region
 * content body, baked at markdown-compile time. Renders like any inline region (the component is the
 * thin `{@html}` shell the emitter produced); awaiting it is a no-op because the HTML is present from
 * birth, so the wire crossing never pays a svelte/server render.
 */
export declare function prebaked_region(component: Component<Record<string, never>>, html: string, 
/** Internal: content-body CSS key, set by the markdown source (see {@link InlineRegion.content_id}). */
content_id?: string): AwaitableRegion;
/**
 * Make a held region with type-checked props.
 *
 * - A plain component import → an **inline** region (renders in this pass; can't cross the wire).
 * - A component imported `with { region: 'raw' }` → a **dual** region: inline where it's made,
 *   a signed ticket where it travels. Minting the marked form is server-only (the signer lives on
 *   the SSR leg) — call it in a load / remote / render context.
 *
 * **A dual region is awaitable.** `await region(Card, props)` renders the component to HTML on
 * the server and bakes it into the ticket, so the client swaps it in with no extra request. In an
 * async generator (`query.live`) or an async remote, `yield region(…)` / `return region(…)` is
 * awaited by the language, so the HTML travels automatically — LiveView over the channel you already
 * have. A held region you *don't* await renders inline where it lands (first paint, same SSR pass).
 */
export declare const region: typeof make_region & {
    snippet: typeof region_snippet;
};
/**
 * A pure-HTML region — what `import.meta.og.code()` / `.md()` inline. The html is baked at build
 * (Shiki / markdown), so this is an INLINE region whose component ({@link RawHtml}) simply renders
 * the html in the page's own SSR pass. Static by construction: it ships as HTML and no client JS of
 * its own. Rendered like any region: `<Region of={…} />`.
 */
export declare function og_html_region(html: string): InlineRegion;
