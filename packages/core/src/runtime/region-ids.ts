/**
 * Which page-scoped hub ids each region's island resolved while it hydrated, kept per region
 * element: the hydrate core captures them, and the reconciler (./reconcile.ts) disposes the ids of
 * the regions a navigation removed.
 *
 * @packageDocumentation
 */
import { set_resolve_sink } from '../ref-sink.ts';

const owned_ids = new WeakMap<Element, Set<string>>();

/** Record that `region`'s island resolved page id `id` (called via the resolve-sink). */
export function record_region_id(region: Element, id: string): void {
	let set = owned_ids.get(region);
	if (set === undefined) owned_ids.set(region, (set = new Set()));
	set.add(id);
}

/** The page ids a region's island owns, or undefined. */
export function region_owned_ids(region: Element): Set<string> | undefined {
	return owned_ids.get(region);
}

/** Run `fn` with the hub's resolve-sink funneling every page id it resolves to `region`'s owned
 *  set, then take the sink down, even when `fn` throws. Wrap an island's SYNC prop/context decode
 *  so the reconciler learns which ids that island owns. */
export function capture_region_ids<T>(region: Element, fn: () => T): T {
	set_resolve_sink((id) => record_region_id(region, id));
	try {
		return fn();
	} finally {
		set_resolve_sink(null);
	}
}
