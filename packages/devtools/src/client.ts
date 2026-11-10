/**
 * The BROWSER half of `devtools()` (its `client`): the profiler's beacon, the dock's launcher, and
 * the leftovers watch (what a region's component leaves running after it leaves the page). With the dock off
 * (`devtools({ dock: false })`, core's events not compiled in) the dock's parts fold to nothing.
 * The beacon hears the runtime through its hooks; so do the dock's readers (devtools/hook-record.ts).
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import { install_devtools_ui } from './devtools/ui.ts';
import {
	watch_leftovers,
	leftover_island_seen,
	leftover_island_gone
} from './devtools/leftovers.ts';
import { record_hook } from './devtools/hook-record.ts';
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

const client: ClientPlugin = defineClient({
	boot({ kitPage }) {
		install_beacon(DOCK);
		if (!DOCK) return;
		// one mounted Svelte app (launcher + tabbed window), starting hidden (Alt+O); a pure bus/DOM consumer
		install_devtools_ui(kitPage ? { csr_true: true } : undefined);
		// watched from before the first island wakes (a Kit page has no ogygia islands)
		if (!kitPage) watch_leftovers();
	},
	hooks: {
		regionMount(e) {
			if (!DOCK) return;
			record_hook('regionMount', e);
			leftover_island_seen(e.el, e.entry, [...e.urls]);
		},
		regionUnmount(e) {
			if (!DOCK) return;
			record_hook('regionUnmount', e);
			leftover_island_gone(e.el, e.entry);
		},
		regionHydrated(e) {
			if (DOCK) record_hook('regionHydrated', e);
			beacon_hydrated(e.el, e.t0, e.tLoaded, e.tDone, e.ssrHtml, e.tTurn);
		},
		regionFailed(e) {
			if (DOCK) record_hook('regionFailed', e);
			beacon_failed(e.el, e.message, e.since, e.turn);
		},
		regionWoke(e) {
			if (DOCK) record_hook('regionWoke', e);
		},
		regionMismatched(e) {
			if (DOCK) record_hook('regionMismatched', e);
		},
		holeAnswered(e) {
			if (DOCK) record_hook('holeAnswered', e);
			beacon_hole_answered(e.el, e.start, e.batch);
		},
		holeFailed(e) {
			if (DOCK) record_hook('holeFailed', e);
			const { el: _el, finalPath, ...h } = e;
			beacon_hole_failed({ ...h, ...(finalPath ? { final_path: finalPath } : {}) });
		},
		holeBatchMissed(e) {
			if (DOCK) record_hook('holeBatchMissed', e);
			const { finalUrl, ...m } = e;
			beacon_hole_batch_missed({ ...m, ...(finalUrl ? { final_url: finalUrl } : {}) });
		},
		entryFallback(e) {
			if (DOCK) record_hook('entryFallback', e);
			beacon_entry_fallback(e);
		},
		navStarted(e) {
			if (DOCK) record_hook('navStarted', e);
		},
		navigated(e) {
			if (DOCK) record_hook('navigated', e);
			beacon_nav(e);
		},
		criticalSettled(e) {
			if (DOCK) record_hook('criticalSettled', e);
			beacon_critical(e);
		},
		loadStarted(e) {
			if (DOCK) record_hook('loadStarted', e);
		},
		warning(e) {
			if (DOCK) record_hook('warning', e);
			beacon_warning(e);
		}
	}
});

export default client;
