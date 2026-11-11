import { getContext, setContext } from 'svelte';

// @why `Symbol.for`, not `Symbol()`: the runtime and each island entry bundle their own copy of this file (test: test/nested-key.test.ts › two copies of nested.ts mark "inside an island" with the same context key)
const NESTED_KEY = Symbol.for('ogygia.nested-island');

/**
 * Mark the current subtree's hydration state. `true` = inside a hydrated island (nested islands
 * degrade). `false` = a LAKE resets its subtree to "dead", so an island inside the lake self-
 * hydrates again (the nearest-boundary rule — DESIGN.md).
 */
export function setNested(value = true): void {
	setContext(NESTED_KEY, value);
}

/** The context an island is hydrated with: a copy of `base` (a `<Provide>` above it), marked
 *  "inside an island" — what a wrapper's `setNested()` gave its children, with no wrapper in the
 *  tree. `base` itself is left as it is. */
export function nested_context(base?: Map<unknown, unknown> | null): Map<unknown, unknown> {
	const context = new Map(base ?? undefined);
	context.set(NESTED_KEY, true);
	return context;
}

/**
 * True when an ancestor island wrapper already marked the subtree. `getContext` returns `undefined`
 * when no ancestor set it (a top-level island) — that absence is exactly "not nested".
 */
export function isNested(): boolean {
	return getContext(NESTED_KEY) === true;
}
