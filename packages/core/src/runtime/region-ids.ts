/**
 * R3 OWNERSHIP: which page-scoped hub ids each region's island resolved during hydration. The
 * hydrate core installs a resolve-sink (ref-sink.ts `set_resolve_sink`) around each island's sync prop +
 * context decode that funnels ids here, keyed by the region element; the reconciler (a navigation)
 * disposes the ids REMOVED regions owned that no region left on the page owns ({@link ids_released}).
 * WeakMap → a removed element's set is GC'd with it.
 * Its own module so the boot-time reconciler and the lazily loaded hydrate core share one map
 * without either importing the other.
 */
import { set_resolve_sink } from '../ref-sink.ts';

const owned_ids = new WeakMap<Element, Set<string>>();

/** Record that `region`'s island resolved page id `id` (called via the resolve-sink). */
export function record_region_id(region: Element, id: string): void {
	let set = owned_ids.get(region);
	if (set === undefined) owned_ids.set(region, (set = new Set()));
	set.add(id);
}

/**
 * The page ids the `departed` regions owned that no region still in `page` owns: the ones to
 * dispose. A shared object (a wired instance, a store passed to two regions) is owned by every
 * region that resolved it, and stays while any of them does (#815).
 */
export function ids_released(departed: readonly Element[], page: ParentNode): string[] {
	const candidates = new Set<string>();
	for (const el of departed) {
		const set = owned_ids.get(el);
		if (set !== undefined) for (const id of set) candidates.add(id);
	}
	if (candidates.size === 0) return [];
	const gone = new Set(departed);
	for (const el of page.querySelectorAll('ogygia-region')) {
		// (a departed region the morph reused in place re-mounts: what it owned is not held)
		if (gone.has(el)) continue;
		const set = owned_ids.get(el);
		if (set !== undefined) for (const id of set) candidates.delete(id);
	}
	return [...candidates];
}

/** Run `fn` with the hub's resolve-sink funneling every page id it resolves to `region`'s owned
 *  set, then restore the previous sink (finally, so a throw can't strand it). Wrap an island's
 *  SYNC prop/context decode so the reconciler learns which ids that island owns. */
export function capture_region_ids<T>(region: Element, fn: () => T): T {
	set_resolve_sink((id) => record_region_id(region, id));
	try {
		return fn();
	} finally {
		set_resolve_sink(null);
	}
}
