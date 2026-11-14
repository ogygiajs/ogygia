import { getContext, setContext } from 'svelte';

// @why `Symbol.for`, not `Symbol()`: the runtime and each island entry bundle their own copy of this file (test: test/nested-key.test.ts › two copies of nested.ts mark "inside an island" with the same context key)
const NESTED_KEY = Symbol.for('ogygia.nested-island');

/**
 * Mark the current subtree's hydration state. `true` = inside a hydrated island (nested islands
 * degrade). `false` = a LAKE resets its subtree to "dead", so an island inside the lake self-
 * hydrates again (the nearest-boundary rule — DESIGN.md).
 */
export function setNested(value = true, wake?: () => string): void {
	setContext(NESTED_KEY, value);
	if (wake) setContext(NESTED_WAKE_KEY, wake);
}

const ISLAND_REGION_KEY = Symbol.for('ogygia.island-region');
const NESTED_WAKE_KEY = Symbol.for('ogygia.nested-wake');

/**
 * The schedule the island around this subtree wakes on: its wrapper's (server render, or a client
 * render inside a wrapper), else the hydrated island element's `wake`. Null when it is not known.
 */
export function nested_wake(): string | null {
	const wake = getContext(NESTED_WAKE_KEY) as (() => string) | undefined;
	if (wake) return wake();
	return island_region()?.getAttribute('wake') ?? null;
}

/** The context an island is hydrated with: a copy of `base` (a `<Provide>` above it), marked
 *  "inside an island" — what a wrapper's `setNested()` gave its children, with no wrapper in the
 *  tree — and naming `region`, the island's element, for every component it mounts (now or later).
 *  `base` itself is left as it is. */
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
		// oxlint-disable-next-line ogygia/no-silent-failures -- not inside a component's run: no island to name
	} catch {
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
