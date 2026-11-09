/**
 * THE HYDRATE CORE — everything an island needs only at the moment it hydrates: Svelte's
 * `hydrate`/`unmount`, the "inside an island" context, the devalue props parse, the page seed, the
 * DEV props guard. Loaded LAZILY by the region element on its first `#hydrate` (one dynamic
 * import, shared by every island), so a page whose islands all wake on `visible` or `interaction`
 * boots the runtime WITHOUT fetching Svelte's client runtime — that arrives with the first island
 * that actually wakes, together with the island's own chunk. The always-on core (`core.ts`) keeps
 * only what every region needs at connect: the schedule, the observers, the hole fetch.
 *
 * Stateless towards the element: the element owns its handle (`IslandHandle`) and its flags; this
 * module owns the how.
 */
import { type Component } from 'svelte';
export declare const seed_page_once: () => void;
export declare const seed_remote_once: () => void;
export declare const kit_page_thread: (signal: AbortSignal) => Promise<unknown> | null;
/** A hydrated island as the element holds it: how to tear it down, and (keep / live hosts) how to
 *  push the next page's props into it. */
export type IslandHandle = {
    dispose(): void;
    set_props?: (props: Record<string, unknown>) => void;
};
/** An island's loaded module: the component, plus a foreign build's own hydrate contract.
 *  `options.recover === false` asks the entry's svelte to THROW on a hydration mismatch instead
 *  of silently re-rendering (the self-heal below needs to know); an older entry ignores it. */
export type IslandModule = {
    default: Component<Record<string, unknown>>;
    __og_hydrate?: (target: Element, props: Record<string, unknown>, options?: {
        recover?: boolean;
    }) => unknown;
    __og_unmount?: (app: unknown) => void;
};
/**
 * MAKE `<svelte:head>` HYDRATION SAFE on a csr=false document, before any island's head effect runs.
 * The caller runs this once per document (see the `head_markers_neutralized` guard at its call site).
 *
 * Svelte renders a component's `<svelte:head>` into `document.head`, not into the component's own
 * DOM, and delimits each block there as `<!--HASH-->` …content… `<!---->` (svelte/internal/server
 * `head()`). Its CLIENT `head(HASH, …)` hydrates by scanning document.head for the comment whose data
 * is HASH, then walking the nodes right after it as that block's content. That contract holds for a
 * whole-page hydrate (csr=true — Kit owns it, and this function never runs), but an ogygia island
 * hydrates in ISOLATION while that scan still reads the ONE shared document.head. By island-wake time
 * a third party has usually mutated the head (a design-system/monitoring inject, a hoisted sheet); a
 * foreign node landing in a block's range desyncs the walk into `set_attribute()` on a non-element,
 * which throws and discards the ENTIRE island (it never wakes). Note ogygia already keeps its OWN
 * head writes off this range by inserting region sheets at the head TOP (core.ts) — this closes the
 * same hole for head writes ogygia does not control.
 *
 * The fix is Svelte's own documented fallback: when `head()` finds no matching HASH marker it flips
 * out of hydration mode and RE-RENDERS the block fresh (svelte-head.js, `head_anchor === null`).
 * Removing the open markers up front takes every island's head down that safe path instead of the
 * fragile walk. The SSR-rendered head ELEMENTS stay (correct, already applied — sheets loaded, title
 * set) until the island's own live copy exists; then the island owns its head content and the
 * page's copy is retired (runtime/session.ts — who owns each node in <head>, and the one-copy rule).
 *
 * A head block is `<!--HASH-->` …content… `<!---->` — the HASH open and the empty close both sit at
 * the head's TOP LEVEL, while the content in between may carry Svelte's own block anchors when the head
 * is looped or branched: `{#if}`/`{#each}`/`{:else}` emit `<!--[-->` / `<!--[!-->` / `<!--[?-->` opens
 * and `<!--]-->` closes (svelte constants HYDRATION_START… and HYDRATION_END). So the open markers are found
 * by walking head's DIRECT children while tracking bracket depth: a comment whose data starts with `[`
 * is a block open (depth+1), `]` is a block close (depth−1), and at depth 0 a non-bracket, non-empty
 * comment is a head-block HASH open — confirmed when a depth-0 empty `<!---->` later closes its block.
 * That confirmation is what tells a real head marker from a lone third-party head comment (which has no
 * depth-0 empty close), so only genuine markers are removed; page/layout head blocks keep every rendered
 * element (their inert markers go), and element children are never descended into.
 */
export declare function neutralize_head_hydration_markers(): void;
/**
 * Does the live node SEQUENCE differ from the server's? Exactly what Svelte's walk reads: node
 * types, element tags, text and comment data, recursively — never attributes (a custom element
 * upgrading adds `tabindex`, `aria-*`, ids; the walk does not care, and neither does this).
 *
 * Asked BEFORE the first hydrate attempt, not after a failed one: Svelte's walk does not verify
 * tags, so on a shifted sequence it writes attributes onto whatever node sits at its cursor —
 * measured on a customer deploy, the login trigger's `id`/`class`/`text` landed on the dropdown's
 * wrapper `<div>` — and only throws further down. A repair that came after would put the text
 * nodes back and leave those attributes on the wrong elements (an unstyled dropdown). Repairing
 * first, the walk never runs on the edited sequence.
 */
export declare function sequence_differs(live: Node, want: Node): boolean;
/** Put the island's light DOM back to the server's node sequence when it drifted while the island
 *  slept. Returns whether a repair was made and, in DEV / devtools, WHY it drifted (the first
 *  divergence, named before the repair rewrites the sequence). Called with the island's lakes LIFTED
 *  (lakes.ts): a lake's content is never part of the walk, and it may legitimately differ from the
 *  server copy by now (a live lake refreshes itself to the visitor before its host wakes) — so the
 *  copy's direct lakes are emptied the same way before the comparison, and the repair never touches
 *  them. */
export declare function repair_if_drifted(region: HTMLElement, ssr_html: string): {
    repaired: boolean;
    reason: string | null;
    conflict: string | null;
};
/** Is this entry another build's (fragment federation): absolute, different origin. */
export declare function is_foreign_entry(entry: string): boolean;
/**
 * Parse a region's `<script data-ogygia-props>` sidecar (keyed at the end of the body, or adjacent —
 * runtime/sidecar.ts). Uses the client reviver (`remember: true`) so a named/shared transportable
 * reunites with its live instance. Returns `{}` when there is no props sidecar.
 */
export declare function read_region_props(region: Element, foreign?: boolean): Record<string, unknown>;
/**
 * THE island hydrate step — synchronous from here on (the element already awaited the module and
 * its scheduler turn): seeds, props, envelope, `hydrate()` through the provider, lake restore,
 * the mutation detector. Returns the handle, or `null` when the island is not ours to hydrate (a
 * Kit-hydrated page — marked `data-kit-hydrated`). Throws on a failed hydrate; the element reports.
 */
export declare function hydrate_island(region: HTMLElement, entry: string, mod: IslandModule, 
/** The island's server markup as it connected (core.ts) — the HYDRATION SOURCE OF TRUTH. When
 *  the live DOM drifted from it while the island slept, hydration is retried against it before
 *  any client render. `null` = no copy (a huge island, an older path): Svelte's own recovery. */
ssr_html?: string | null, 
/** Was the island's markup touched since that copy (runtime/drift-watch.ts, read by the element
 *  before this step edits it)? `false` skips the comparison: nothing could have drifted. */
touched?: boolean): IslandHandle | null;
/**
 * Hydrate a live region's swapped-in HTML with pushable props, so a later tick reaches the mounted
 * island in place. Its HTML is svelte `render()`'s (the root anchor pair already there) — the
 * deferred swap's shape, so it is never wrapped again. `null` when the live feature is absent.
 */
export declare function hydrate_live(region: HTMLElement, entry: string, mod: IslandModule, props: Record<string, unknown>): IslandHandle | null;
