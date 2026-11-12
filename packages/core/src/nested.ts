import { getContext, setContext } from 'svelte';

// Context key marking "this subtree is already inside a hydrated island". Nested island wrappers
// read it and degrade to a plain inline component so an island-within-an-island hydrates exactly
// once, together with its parent.
//
// KEY IDENTITY (CTX-KEY): must be `Symbol.for` (global registry), NOT `createContext`'s per-call
// `Symbol()`. The runtime bundle (which hydrates an island → nested_context) and each island-entry
// bundle (which renders a lake region → isNested) are SEPARATE Vite entry graphs; `context.ts` is
// duplicated across them on the client, so a per-module `Symbol()` mints a different key in each —
// setNested and isNested then miss each other and a lake renders no `<ogygia-region hydrate="none">`,
// so the lift/restore drops it. SSR bundles once, so the key matches there — hence it broke ONLY
// after client hydration. A global `Symbol.for` is one key across every graph.
//
// A leaf of its own (context.ts re-exports it): the hydrate core needs only this,
// and the hydrate core shares modules with Kit's client graph, which uses the rest of context.ts. A
// shared module ships whole, so importing context.ts from the hydrate core sent every island page
// the request-scoped claim helpers it never runs.
const NESTED_KEY = Symbol.for('ogygia.nested-island');

/**
 * Mark the current subtree's hydration state. `true` = inside a hydrated island (nested islands
 * degrade). `false` = a LAKE resets its subtree to "dead", so an island inside the lake self-
 * hydrates again (the nearest-boundary rule — DESIGN.md).
 */
export function setNested(value = true): void {
	setContext(NESTED_KEY, value);
}

/** The island's region element, in its context (one `Symbol.for` key across graphs, as above). */
const ISLAND_REGION_KEY = Symbol.for('ogygia.island-region');

/** The context an island is hydrated with: `base` (a `<Provide>` above it), marked "inside an
 *  island" — what a wrapper's `setNested()` gave its children, with no wrapper in the tree — and
 *  naming `region`, the island's element, for every component it mounts (now or later). */
export function nested_context(
	base?: Map<unknown, unknown> | null,
	region?: Element | null
): Map<unknown, unknown> {
	const context = new Map(base ?? undefined);
	context.set(NESTED_KEY, true);
	if (region) context.set(ISLAND_REGION_KEY, region);
	return context;
}

/**
 * The region of the island whose component is running now: any component it mounted, also one
 * mounted long after it hydrated (#853). Null outside a component (an event handler, module scope)
 * or outside an island.
 */
export function island_region(): Element | null {
	try {
		return (getContext(ISLAND_REGION_KEY) as Element | undefined) ?? null;
	} catch {
		// ok: not inside a component's run: no island to name
		return null;
	}
}

/**
 * True when an ancestor island wrapper already marked the subtree. `getContext` returns `undefined`
 * when no ancestor set it (a top-level island) — that absence is exactly "not nested".
 */
export function isNested(): boolean {
	return getContext(NESTED_KEY) === true;
}
