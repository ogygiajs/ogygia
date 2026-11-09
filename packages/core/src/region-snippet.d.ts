/**
 * Region snippets — the snippet shape of a region. "Everything that crosses an island boundary is a
 * region; components and snippets are its two shapes; static freezes, live wakes."
 *
 * A snippet handed to a component is a function, so it can't cross an island boundary directly (devalue
 * can't stringify a function). A region snippet is a real Svelte snippet — same-graph `{@render}`
 * renders it inline — that also carries a serializable DESCRIPTOR and knows how to REVIVE on the far
 * side. One primitive, two modes:
 *
 *  - **live** — the compiler, at a snippet's DEFINITION site, compiles its body into an island ENTRY
 *    and constructs a live region snippet (`{ m:'live', e, p }`). It renders the entry inline on the
 *    server and HYDRATES it on the client, so the markup comes alive. This is the former "portable
 *    snippet" path, unchanged in behavior, now expressed as the live mode of this one primitive.
 *  - **static** — a PLAIN snippet reaching a boundary is FROZEN to its server-rendered HTML
 *    (`{ m:'static', h }`). The client adopts that HTML byte-for-byte; nothing re-runs. No compiler
 *    involvement, so it survives wrappers, re-exports, and a consumer swapping in their own component.
 *    Correct for markdown content (prose, code): static, never reactive.
 *
 * The boundary law lives in ONE place — {@link reduce_region_snippet}: a branded region snippet crosses
 * as its descriptor; a bare snippet is captured static; a parameterized snippet that can't be frozen
 * throws, loudly. Revival is its single inverse, {@link revive_region_snippet}. `createRawSnippet` is
 * isomorphic (server calls `render`, client calls `setup`), so one factory serves both legs of both
 * modes with no manual environment branch.
 */
import { type Component, type Snippet } from 'svelte';
/** Devalue custom-type name a region snippet crosses under (wire-stable; was `OgygiaS`). */
export declare const REGION_SNIPPET_WIRE_KEY = "OgygiaS";
/** The serializable stand-in a region snippet crosses as, discriminated by mode. */
export type RegionSnippetDescriptor = {
    m: 'live';
    e: string;
    p: Record<string, unknown>;
} | {
    m: 'static';
    h: string;
} | {
    m: 'slot';
    id: string;
};
/** A snippet stamped with its region descriptor. */
type RegionSnippet = Snippet & {
    __ogRegion?: RegionSnippetDescriptor;
};
/**
 * Definition-site factory (compiler-emitted). Brands the snippet AS WRITTEN (`native`) — it keeps
 * rendering in place, in the host's tree: the host's context, its scoped CSS, a nested island as a plain
 * page island — with the descriptor (`__ogRegion`, what crosses the wire) and its PORTABLE form: the
 * body compiled to `Entry`, rendered in isolation on the server and hydrated alone on the client. Only a
 * boundary swaps the portable form in (portable-form.ts, via {@link prepare_region_props}), so the server
 * markup and the client's revived snippet agree. `Entry` is `null` in a client bundle (the far side
 * imports it by url). The native function is branded in place (not wrapped), so its identity — what a
 * `{@render}` keys on — is stable across re-evaluations of the prop.
 */
export declare function og_portable(native: Snippet, Entry: Component | null, props: Record<string, unknown>, url: string): RegionSnippet;
export interface RawRegionSnippet {
    /** Single-root HTML for SSR + hydration match (same rule as `createRawSnippet`). */
    render: (...captures: unknown[]) => string;
    /** Client behavior after mount/adoption. DROPPED if this snippet is reduced across a wire. */
    setup?: (root: Element, ...captures: unknown[]) => (() => void) | void;
    /** Devalue-serializable inputs — same law as island props. */
    captures?: unknown[];
}
/** Lift a parameterless snippet, or a raw `{ render, setup?, captures? }`, into a region snippet. */
export declare function region_snippet(input: Snippet | RawRegionSnippet): RegionSnippet;
/**
 * Prepare an island's props for crossing: freeze each BARE snippet prop to a single-rooted static
 * region snippet, so the SAME value renders the island body AND serializes — the body HTML and the
 * revived client snippet then agree byte-for-byte, and hydration adopts cleanly. Server-only (uses SSR
 * capture). A branded (live) snippet, at any depth, is swapped for its PORTABLE form; non-snippet values
 * pass through untouched. Returns the original object when nothing changed (no needless copy).
 */
export declare function prepare_region_props(input: Record<string, unknown>): Record<string, unknown>;
/** The SSR marker that fences an island's in-place children so the client can adopt exactly that range.
 *  `display:contents` keeps it layout-neutral. */
export declare function slot_marker_open(id: string): string;
export declare const SLOT_MARKER_CLOSE = "</ogygia-slot>";
export declare function next_slot_id(key?: string): string;
/** The serialize-only stand-in for in-place children: a branded value the codec reduces to a `slot`
 *  descriptor. Never rendered (the server body renders the real children); on the client it revives to a
 *  snippet that ADOPTS the marked DOM range. */
export declare function slot_pointer(id: string): RegionSnippet;
/** The hub kind: a snippet is a renderable Ref ("a snippet is a region", now literal). A branded
 *  region snippet crosses as its descriptor; a bare snippet FREEZES at the boundary (server-only —
 *  the BROWSER guard also keeps `capture_static` → `svelte/server` DCE-able out of client bundles);
 *  a bare function on the CLIENT falls through (never claimed — it can't freeze there). */
/** Explicit registration — called at module scope AND from live-transport's install():
 *  a bare side-effect import gets tree-shaken (the package marks JS side-effect-free),
 *  which silently un-registers the kind in client bundles. A CALLED import cannot be dropped. */
export declare function register_snippet_kind(): void;
/** Codec encode (legacy `OgygiaS` wire shape: the bare descriptor). Branded region snippet → its
 *  descriptor; a bare snippet → frozen static; anything else falls through. */
export declare function reduce_region_snippet(value: unknown): RegionSnippetDescriptor | undefined;
/** Codec decode. Rebuild a live snippet from the descriptor (both modes). Snippets are functions,
 *  which the hub deliberately never memoizes — each consumer revives its own (stateless until
 *  rendered), exactly the pre-hub behavior. */
export declare function revive_region_snippet(desc: RegionSnippetDescriptor): RegionSnippet;
export {};
