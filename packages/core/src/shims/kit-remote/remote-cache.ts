/** SSR-resolved remote response maps shared by Kit remote-functions + ogygia SPA reset. */
import { current_region } from '../../current-region.ts';
import { island_region } from '../../nested.ts';

type RemoteNode = { v?: unknown; e?: [number, unknown] };

type RemoteResource = {
	destroy?: () => void;
	refresh?: () => Promise<unknown>;
	reconnect?: () => Promise<unknown>;
};
type RemoteEntry = { resource?: RemoteResource };

/** The regions whose islands read each Kit query entry: its holders. */
const holders = new WeakMap<RemoteEntry, Set<Element>>();

/** Record the island reading now (if any) as a holder of `entry`: the one hydrating, or the one
 *  whose component runs now (a child it mounted after it hydrated, #853). */
function hold(entry: RemoteEntry): void {
	const region = current_region() ?? island_region();
	if (region === null) return;
	let set = holders.get(entry);
	if (set === undefined) holders.set(entry, (set = new Set()));
	set.add(region);
}

/**
 * One query function's entries (payload → entry). Kit makes this map itself (`ensure_entry`), and
 * {@link QueryMap} adopts it, so every lookup and insert passes through here: an island's proxy is
 * built during its hydrate, and that lookup or insert names the island's region a holder.
 * The same shape in Kit 2 and Kit 3 (`remote-functions/cache.svelte.js`).
 */
class QueryEntries extends Map<string, RemoteEntry> {
	override get(payload: string): RemoteEntry | undefined {
		const entry = super.get(payload);
		if (entry !== undefined) hold(entry);
		return entry;
	}
	override set(payload: string, entry: RemoteEntry): this {
		hold(entry);
		return super.set(payload, entry);
	}
}

/** Kit's `query_map` / `live_query_map` (id → entries), adopting each inner map Kit stores. */
class QueryMap extends Map<string, Map<string, RemoteEntry>> {
	override set(id: string, entries: Map<string, RemoteEntry>): this {
		// (Kit keeps its own reference to the map it made and inserts into it, so the map itself
		// becomes a QueryEntries: same entries, same identity)
		if (!(entries instanceof QueryEntries)) Object.setPrototypeOf(entries, QueryEntries.prototype);
		return super.set(id, entries);
	}
}

/**
 * Kit remote-function response + instance cache.
 *
 * SSR seeds (`query_responses`) are cleared in `prepare_spa_document` (before replaceWith). After
 * the swap, `finish_spa_document` releases the instances the departed islands held: an entry whose
 * holders all left the page is destroyed, so the next page builds a fresh one (a LiveQuery's
 * `#start` is `once()`). One a kept island still holds keeps running (#817). One no island held
 * while it hydrated (made in an event handler or at module scope) lives as long as Kit's own
 * references to it say.
 */
export class RemoteCache {
	readonly query_responses: Record<string, RemoteNode> = {};
	readonly prerender_responses: Record<string, RemoteNode> = {};
	readonly query_map: Map<string, Map<string, RemoteEntry>> = new QueryMap();
	readonly live_query_map: Map<string, Map<string, RemoteEntry>> = new QueryMap();

	/** Drop SSR seed bags only (safe while old islands are still connected). */
	clear_seeds(): void {
		for (const k of Object.keys(this.query_responses)) delete this.query_responses[k];
		for (const k of Object.keys(this.prerender_responses)) delete this.prerender_responses[k];
	}

	/**
	 * Destroy the query/live instances whose holders have all left the page, and drop them from the
	 * maps. Call after the swap, once the reconcile has settled which regions stay.
	 */
	release_instances(): void {
		release_departed(this.query_map);
		release_departed(this.live_query_map);
	}

	/**
	 * Re-fetch every live query instance in place (Kit's `refreshAll` does the same to its own maps):
	 * queries refresh, live queries reconnect. Settles when all of them have.
	 */
	refresh_instances(): Promise<void> {
		const pending: Promise<unknown>[] = [];
		for (const entries of this.query_map.values()) {
			for (const { resource } of entries.values())
				if (resource?.refresh) pending.push(resource.refresh());
		}
		for (const entries of this.live_query_map.values()) {
			for (const { resource } of entries.values())
				if (resource?.reconnect) pending.push(resource.reconnect());
		}
		return Promise.allSettled(pending).then(() => {});
	}
}

/** Has every region that held `entry` left the page? False for an entry no region held. */
function departed(entry: RemoteEntry): boolean {
	const set = holders.get(entry);
	if (set === undefined) return false;
	for (const region of set) if (region.isConnected) return false;
	return true;
}

function release_departed(map: Map<string, Map<string, RemoteEntry>>) {
	for (const [id, entries] of map) {
		for (const [payload, entry] of entries) {
			if (!departed(entry)) continue;
			try {
				entry.resource?.destroy?.();
				// oxlint-disable-next-line ogygia/no-silent-failures -- already torn down, which is what this was for
			} catch {}
			entries.delete(payload);
		}
		if (entries.size === 0) map.delete(id);
	}
}

const GLOBAL_KEY = '__ogygia_remote_cache__';

/**
 * Process-wide singleton on `globalThis`.
 * Vite can load this file under multiple resolved ids (`/@fs/…` vs absolute, runtime
 * chunk vs island graph); module-level `new RemoteCache()` would then create separate
 * maps, so SPA `clear_*` would miss the maps Kit's LiveQuery actually uses.
 */
function get_remote_cache(): RemoteCache {
	const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: RemoteCache };
	if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new RemoteCache();
	return g[GLOBAL_KEY];
}

export const remote_cache: RemoteCache = get_remote_cache();

export const query_responses: RemoteCache['query_responses'] = remote_cache.query_responses;
export const prerender_responses: RemoteCache['prerender_responses'] =
	remote_cache.prerender_responses;
export const query_map: RemoteCache['query_map'] = remote_cache.query_map;
export const live_query_map: RemoteCache['live_query_map'] = remote_cache.live_query_map;

export function clear_remote_seeds(): void {
	remote_cache.clear_seeds();
}

export function release_remote_instances(): void {
	remote_cache.release_instances();
}

export function refresh_remote_instances(): Promise<void> {
	return remote_cache.refresh_instances();
}
