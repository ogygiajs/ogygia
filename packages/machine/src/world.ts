/** The most keys a keyed world remembers moves for; an older key's move folds into the floor. */
export const KEYS_KEPT = 4096;

type Hear<K, O> = (owner: O, keys: ReadonlySet<K> | null) => void;

type Watcher<K> = { owner: WeakRef<object>; hear: Hear<K, object> };

const forget = /* @__PURE__ */ new FinalizationRegistry<{
	watchers: Set<Watcher<never>>;
	watcher: Watcher<never>;
}>(({ watchers, watcher }) => watchers.delete(watcher));

export interface World<K = never> {
	/** The world now: what data made now is stamped with. */
	stamp(): number;
	/** Still the world `stamp` was taken in: nothing moved since (with `keys`: none of them, and
	 *  not the whole world). */
	fresh(stamp: number, keys?: Iterable<K>): boolean;
	/** Moves the world on: the whole of it, or (a keyed world) only `keys`. An empty `keys` moves
	 *  nothing. */
	bump(keys?: Iterable<K>): void;
}

class Stamped<K> implements World<K> {
	_at = 0;
	_floor = 0;
	_moved = new Map<K, number>();
	_watchers = new Set<Watcher<K>>();

	stamp(): number {
		return this._at;
	}

	fresh(stamp: number, keys?: Iterable<K>): boolean {
		if (keys === undefined) return stamp === this._at;
		if (stamp < this._floor || stamp > this._at) return false;
		if (stamp === this._at) return true;
		for (const key of keys) if ((this._moved.get(key) ?? 0) > stamp) return false;
		return true;
	}

	bump(keys?: Iterable<K>): void {
		if (keys === undefined) {
			this._floor = ++this._at;
			this._moved.clear();
			this._tell(null);
			return;
		}
		const moved = new Set(keys);
		if (moved.size === 0) return;
		const at = ++this._at;
		const map = this._moved;
		for (const key of moved) {
			// @why the newest move goes last, so the oldest folds into the floor first (test: test/world.test.ts › a key moved again goes to the back of the line: past KEYS_KEPT, the oldest move folds, not its newest)
			map.delete(key);
			map.set(key, at);
		}
		for (const [key, last] of map) {
			if (map.size <= KEYS_KEPT) break;
			this._floor = last;
			map.delete(key);
		}
		this._tell(moved);
	}

	_tell(keys: ReadonlySet<K> | null): void {
		for (const watcher of this._watchers) {
			const owner = watcher.owner.deref();
			if (owner === undefined) this._watchers.delete(watcher);
			else watcher.hear(owner, keys);
		}
	}
}

/** Hears each move of `w` for `owner` until the returned function is called, or until `owner` is
 *  collected (the world holds it weakly; `hear` must not hold it either): what the package's own
 *  primitives use (flights drops what a move touches). `null`: not a world `world()` made, so not
 *  heard. */
export function watch_world<K, O extends object>(
	w: World<K>,
	owner: O,
	hear: Hear<K, O>
): (() => void) | null {
	if (!(w instanceof Stamped)) return null;
	const watchers = (w as Stamped<K>)._watchers;
	const watcher: Watcher<K> = { owner: new WeakRef(owner), hear: hear as Hear<K, object> };
	watchers.add(watcher);
	const token = {};
	forget.register(
		owner,
		{ watchers: watchers as Set<Watcher<never>>, watcher: watcher as Watcher<never> },
		token
	);
	return () => {
		watchers.delete(watcher);
		forget.unregister(token);
	};
}

/**
 * The world data is made in: a world of one stamp, or (`world.keyed()`) one moved per key. A world
 * holds a stamp that only moves forward: data takes the stamp when it is made, and a read refuses
 * data whose stamp is out of date. A scope stops work that outlives its owner; a world stops data
 * that outlives the facts it was made from.
 *
 *   const pages = world(); // one stamp for the whole world
 *   const made = pages.stamp();
 *   const html = await fetch_page(href);
 *   if (!pages.fresh(made)) return; // a change since: this page is from before it
 *   pages.bump(); // a mutation: every stamp taken so far is out of date
 *
 *   const sources = world.keyed<string>(); // one stamp, moved key by key
 *   const made = sources.stamp();
 *   const doc = await fetch_doc(path);
 *   if (!sources.fresh(made, doc.tags)) …; // one of the sources it read changed since
 *   sources.bump(['post:12']); // only data that read post 12 goes out of date
 *
 * - `stamp()` is the world now. `bump()` moves it on: every stamp taken before is out of date. A
 *   stamp from the future is never fresh.
 * - A keyed world moves per key too: `bump(keys)` puts out of date only what read those keys, and
 *   `fresh(stamp, keys)` says no key in `keys` moved since `stamp` (and the whole world did not).
 *   `fresh(stamp)` with no keys asks whether anything at all moved. An empty `bump([])` moves
 *   nothing.
 * - A keyed world remembers the last moves of the newest `KEYS_KEPT` keys. An older key's move
 *   folds into a floor: a stamp from before it is out of date for every key. That errs one way
 *   only: data may be made again that was still good, never kept when it was not.
 * - Flights can take a world (`flights({ world, touches })`): a move ends what it touches at once
 *   (a kept answer goes, and with no `touches` a flight out does too), and an answer whose world
 *   moved while it was out is `STALE` for every caller that joined it. The world holds its flights
 *   weakly: a flights nobody else holds is collected, and its world forgets it.
 */
export const world: {
	(): World;
	keyed<K>(): World<K>;
} = Object.assign((): World => new Stamped<never>(), {
	keyed: <K>(): World<K> => new Stamped<K>()
});
