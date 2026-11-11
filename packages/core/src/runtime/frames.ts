/**
 * frames feature: hand the client frame store to core through the {@link ./slots.js slots} seam.
 *
 * Core drives deferred / live / SWR-lake regions off this store (subscribe → apply, ensure →
 * single-flight fetch, a caller's signal → its leaving), and the router single-flights a route's deferred holes through
 * `stream` — but NEITHER may statically import the store, or the ~10 kB store + nav-stream graph
 * lands in every build, including a plain router app with no such region. The generated runtime entry
 * installs this feature only when the app actually ships a deferred / live / lake region, so a
 * static-islands app (and a router app without deferred regions) tree-shakes the whole graph away.
 */
import { slots } from './slots.ts';
import { subscribe, ensure, peek, renew, renewal } from './frame-store.ts';
import { watch_frames } from './rules.ts';
import { batch_times, join_batch, streamFrames } from './frame-nav.ts';
import { adopt_early_holes } from './early-holes.ts';
import { runtime_session } from './session.ts';

// the runtime's rules (./rules.ts): in dev and OGYGIA_RULES=1 builds only; folds out of any other
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

export function install(): void {
	// (a region shows the answer its address holds: the rule reads the store)
	if (RULES) watch_frames(peek);
	// the requests the head started for this page's `load` holes: the flights at their addresses,
	// before any hole wakes or a batch gathers (./early-holes.ts)
	adopt_early_holes(runtime_session.visit.scope);
	slots.frames = {
		subscribe,
		ensure,
		renew,
		renewal,
		stream: (endpoints, visit) => streamFrames(endpoints, 'nav', visit),
		join: join_batch,
		batch_times
	};
}
