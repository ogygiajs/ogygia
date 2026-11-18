/** SSR-resolved remote response maps shared by Kit remote-functions + ogygia SPA reset. */
import { current_region } from '../../current-region.ts';
import { island_region } from '../../nested.ts';

type RemoteNode = { v?: unknown; e?: [number, unknown] };

type RemoteResource = {
	destroy?: () => void;
	refresh?: () => Promise<unknown>;
	reconnect?: () => Promise<unknown>;
};
type RemoteEntry = { resource?: RemoteResource; proxy_count?: number; cleanup?: () => void };

/** The regions whose islands read each Kit query entry: its holders. */
const holders = new WeakMap<RemoteEntry, Set<Element>>();

/** Record the island reading now (if any) as a holder of `entry`: the one hydrating, or the one
 *  whose component runs now (a child it mounted after it hydrated, #853). */
function hold(entry: RemoteEntry, region: Element | null): void {
	if (region === null) return;
	let set = holders.get(entry);
	if (set === undefined) holders.set(entry, (set = new Set()));
	set.add(region);
}

const settled = (): Promise<undefined> => Promise.resolve(undefined);

const LEFT_RESOURCE: Readonly<Promise<undefined> & RemoteResource> = Object.freeze(
	Object.assign(settled(), {
		current: undefined,
		error: undefined,
		loading: false,
		ready: false,
		connected: false,
		done: true,
		refresh: settled,
		reconnect: settled,
		set: (): void => {},
		withOverride: () => (): void => {},
		destroy: (): void => {},
		async *[Symbol.asyncIterator]() {}
	})
);

class LeftEntry {
	readonly resource = LEFT_RESOURCE;
	readonly #departed: RemoteEntry;

	constructor(departed: RemoteEntry) {
		this.#departed = departed;
	}

	get proxy_count(): number {
		return this.#departed.proxy_count ?? 0;
	}

	set proxy_count(n: number) {
		this.#departed.proxy_count = n;
	}

	cleanup(): void {
		this.#departed.cleanup?.();
	}

	/**
	 * Hand the departed entry's place to `heir`, the fresh entry Kit made for a new reader: the
	 * departed proxies now read `heir`, so they count toward it, and Kit drops it only when the last
	 * proxy of either kind is gone. The departed entry's own teardown runs now, since Kit never will.
	 */
	bequeath(heir: RemoteEntry): void {
		const departed = this.#departed;
		heir.proxy_count = (heir.proxy_count ?? 0) + (departed.proxy_count ?? 0);
		Object.defineProperty(departed, 'proxy_count', {
			configurable: true,
			get: () => heir.proxy_count ?? 0,
			set: (n: number) => {
				heir.proxy_count = n;
			}
		});
		try {
			departed.cleanup?.();
			// oxlint-disable-next-line ogygia/no-silent-failures -- already torn down, which is what this was for
		} catch {}
	}
}

/** A new reader's proxy build, and the left entry that gave way to it (if one did). */
class Build {
	giving_way: LeftEntry | null = null;
}

let building: Build | null = null;

/**
 * Run `make` as a new reader of a query: a query maker's call (`getCount()`, `query.live` and
 * `query.batch` alike), wherever it comes from (an island hydrating, a click handler, a module's top
 * level). Its lookup is a new reader's, so a left entry gives way to it.
 */
export function new_reader<T>(make: () => T): T {
	const outer = building;
	building = new Build();
	try {
		return make();
	} finally {
		building = outer;
	}
}

/**
 * One query function's entries (payload → entry). Kit makes this map itself (`ensure_entry`), and
 * {@link QueryMap} adopts it, so every lookup and insert passes through here: an island's proxy is
 * built during its hydrate, and that lookup or insert names the island's region a holder.
 * The same shape in Kit 2 and Kit 3 (`remote-functions/cache.svelte.js`).
 *
 * A left entry answers every read by a departed island's own proxies. A new reader's lookup
 * ({@link new_reader}) gets nothing instead, so Kit builds a fresh entry in its place, and the left
 * entry bequeaths its place to it ({@link LeftEntry.bequeath}).
 */
class QueryEntries extends Map<string, RemoteEntry> {
	override get(payload: string): RemoteEntry | undefined {
		const entry = super.get(payload);
		if (entry === undefined) return undefined;
		if (!(entry instanceof LeftEntry)) hold(entry, current_region() ?? island_region());
		else if (building !== null) {
			super.delete(payload);
			building.giving_way = entry;
			return undefined;
		}
		return entry;
	}
	override set(payload: string, entry: RemoteEntry): this {
		if (!(entry instanceof LeftEntry)) {
			hold(entry, current_region() ?? island_region());
			if (building?.giving_way) {
				building.giving_way.bequeath(entry);
				building.giving_way = null;
			}
		}
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
 *
 * A departed island owns its queries to the end: work of its own still running after it left (a
 * click handler awaiting a command) reads a left entry in their place, which changes nothing and
 * settles at once (`refresh()` is a no-op, never Kit's "No cached query found", #2007). The next
 * call that makes the same query, in an island or outside any (#2041), gets a fresh one; until then
 * Kit drops the left entry with the departed island's last proxy.
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
	 * maps (leaving a left entry where a departed proxy still lives). Call after the swap, once the
	 * reconcile has settled which regions stay.
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
			if ((entry.proxy_count ?? 0) > 0) {
				entries.set(payload, new LeftEntry(entry));
				continue;
			}
			try {
				entry.cleanup?.();
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
