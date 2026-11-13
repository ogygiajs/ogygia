/**
 * Who owns each page-scoped hub id: every region whose island resolved it while it hydrated, and
 * the document whose page seed revived it. An id nobody captured is the page's on screen. A
 * navigation releases every id nothing on the next page owns (./reconcile.ts `release_page_ids`).
 *
 * @packageDocumentation
 */
import { resolve_sink, set_resolve_sink } from '../ref-sink.ts';

const owned_ids = new WeakMap<object, Set<string>>();

/** Record that `owner` (a region element, or a seed's document) resolved page id `id`. */
export function record_region_id(owner: object, id: string): void {
	let set = owned_ids.get(owner);
	if (set === undefined) owned_ids.set(owner, (set = new Set()));
	set.add(id);
}

/**
 * Of `candidates` (the page ids held now), the ones nothing on the next page owns: no region still
 * in `page` but the `departed` (a departed region the morph reused in place re-mounts, so what it
 * owned is not held), and not `next` (the next page's seed document). A shared object is owned by
 * every region that resolved it, and stays while any of them does. The departed forget what they
 * owned: a reused one records afresh as it re-mounts.
 */
export function ids_released(
	candidates: readonly string[],
	departed: readonly Element[],
	page: ParentNode,
	next: object
): string[] {
	if (candidates.length === 0) return [];
	const left = new Set(candidates);
	const gone = new Set(departed);
	const hold = (owner: object) => {
		const set = owned_ids.get(owner);
		if (set !== undefined) for (const id of set) left.delete(id);
	};
	hold(next);
	for (const el of page.querySelectorAll('ogygia-region')) if (!gone.has(el)) hold(el);
	for (const el of departed) owned_ids.delete(el);
	return [...left];
}

/** Run `fn` with the hub's resolve-sink funneling every page id it resolves to `owner`'s owned
 *  set, then put back the sink it found, even when `fn` throws. Wrap an island's SYNC prop/context
 *  decode, or a page seed's revival, so a navigation learns who owns which ids. */
export function capture_region_ids<T>(owner: object, fn: () => T): T {
	const outer = resolve_sink;
	set_resolve_sink((id) => record_region_id(owner, id));
	try {
		return fn();
	} finally {
		set_resolve_sink(outer);
	}
}
