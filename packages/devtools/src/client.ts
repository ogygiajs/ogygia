/**
 * The BROWSER half of `devtools()` (its `client`): the profiler's beacon, the dock's launcher, and
 * the leftovers watch (what a region's component leaves running after it leaves the page). With the dock off
 * (`devtools({ dock: false })`, core's events not compiled in) the dock's parts fold to nothing.
 * The beacon hears the runtime through its hooks.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import { install_devtools_ui } from './devtools/ui.ts';
import {
	watch_leftovers,
	leftover_island_seen,
	leftover_island_gone
} from './devtools/leftovers.ts';
import {
	beacon_critical,
	beacon_entry_fallback,
	beacon_failed,
	beacon_hole_answered,
	beacon_hole_batch_missed,
	beacon_hole_failed,
	beacon_hydrated,
	beacon_nav,
	beacon_warning,
	install_beacon
} from './profiler/beacon.ts';

const DOCK = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

// (named, so `boot` and each hook keep one id however the rest of this file changes)
const plugin: ClientPlugin = {
	boot({ kitPage }) {
		install_beacon();
		if (!DOCK) return;
		// one mounted Svelte app (launcher + tabbed window), starting hidden (Alt+O); a pure bus/DOM consumer
		install_devtools_ui(kitPage ? { csr_true: true } : undefined);
		// watched from before the first island wakes (a Kit page has no ogygia islands)
		if (!kitPage) watch_leftovers();
	},
	hooks: {
		regionMount({ el, entry, urls }) {
			if (DOCK) leftover_island_seen(el, entry, [...urls]);
		},
		regionUnmount({ el, entry }) {
			if (DOCK) leftover_island_gone(el, entry);
		},
		regionHydrated({ el, t0, tLoaded, tDone, ssrHtml, tTurn }) {
			beacon_hydrated(el, t0, tLoaded, tDone, ssrHtml, tTurn);
		},
		regionFailed({ el, message, since, turn }) {
			beacon_failed(el, message, since, turn);
		},
		holeAnswered({ el, start, batch }) {
			beacon_hole_answered(el, start, batch);
		},
		holeFailed({ finalPath, ...h }) {
			beacon_hole_failed({ ...h, ...(finalPath ? { final_path: finalPath } : {}) });
		},
		holeBatchMissed({ finalUrl, ...m }) {
			beacon_hole_batch_missed({ ...m, ...(finalUrl ? { final_url: finalUrl } : {}) });
		},
		entryFallback(f) {
			beacon_entry_fallback(f);
		},
		navigated(n) {
			beacon_nav(n);
		},
		criticalSettled(e) {
			beacon_critical(e);
		},
		warning(w) {
			beacon_warning(w);
		}
	}
};

const client: ClientPlugin = defineClient(plugin);

export default client;
