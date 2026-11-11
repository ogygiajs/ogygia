/**
 * The BROWSER half of `devtools()` with the dock on: the profiler's beacon (client-beacon.ts), the
 * dock's launcher, the leftovers watch (what a region's component leaves running after it leaves the
 * page), and the record of runtime hook calls the dock's readers read (devtools/hook-record.ts).
 * `devtools({ dock: false })` registers client-beacon.ts instead, so its build keeps the beacon's
 * hooks alone.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import { devtools_switched_on } from '@ogygia/core/internal/instruments';
import { install_devtools_ui } from './devtools/ui.ts';
import {
	watch_leftovers,
	leftover_island_seen,
	leftover_island_gone
} from './devtools/leftovers.ts';
import { record_realm, record_hook } from './devtools/hook-record.ts';
import {
	beacon_critical,
	beacon_entry_fallback,
	beacon_nav,
	beacon_warning,
	install_beacon
} from './profiler/beacon.ts';
import {
	on_hole_answered,
	on_hole_batch_missed,
	on_hole_failed,
	on_region_failed,
	on_region_hydrated
} from './client-beacon.ts';
import { standalone_beacon } from './profiler/beacon-standalone.ts';
import { start_page_beacon } from './page-beacon-start.ts';

const BEACON_KEY = Symbol.for('ogygia.beacon');
const LAZY = typeof __OGYGIA_DEVTOOLS_LAZY__ !== 'undefined' ? __OGYGIA_DEVTOOLS_LAZY__ : false;

// (named, so `boot` and each hook keep one id however the rest of this file changes)
const plugin: ClientPlugin = {
	boot({ kitPage }) {
		record_realm({
			dev: import.meta.env.DEV,
			lend: () => import('./devtools/realm-loan.ts')
		});
		// @why the dev dock measures every document, and an app without ogygia's handle gets no beacon tag from the server (test: e2e/dev-installed.spec.ts › two copies)
		if (!LAZY) standalone_beacon();
		install_beacon(true);
		// one mounted Svelte app (launcher + tabbed window), starting hidden (Alt+O); a pure bus/DOM consumer
		install_devtools_ui(kitPage ? { csr_true: true } : undefined);
		// @why a build's dock measures a switched-on browser, and an app without ogygia's handle gets no beacon tag; a lazy chunk, so other builds pay nothing (test: e2e/dock-switch.spec.ts › the page beacon in a build)
		if (LAZY && devtools_switched_on() && !(globalThis as Record<symbol, unknown>)[BEACON_KEY])
			void start_page_beacon(); // ok: it never rejects (a failed download is warned inside)
		// watched from before the first island wakes (a Kit page has no ogygia islands)
		if (!kitPage) watch_leftovers();
	},
	hooks: {
		regionMount(e) {
			record_hook('regionMount', e);
			leftover_island_seen(e.el, e.entry, [...e.urls]);
		},
		regionUnmount(e) {
			record_hook('regionUnmount', e);
			leftover_island_gone(e.el, e.entry);
		},
		regionHydrated(e) {
			record_hook('regionHydrated', e);
			on_region_hydrated(e);
		},
		regionFailed(e) {
			record_hook('regionFailed', e);
			on_region_failed(e);
		},
		regionWoke(e) {
			record_hook('regionWoke', e);
		},
		regionMismatched(e) {
			record_hook('regionMismatched', e);
		},
		holeAnswered(e) {
			record_hook('holeAnswered', e);
			on_hole_answered(e);
		},
		holeFailed(e) {
			record_hook('holeFailed', e);
			on_hole_failed(e);
		},
		holeBatchMissed(e) {
			record_hook('holeBatchMissed', e);
			on_hole_batch_missed(e);
		},
		entryFallback(e) {
			record_hook('entryFallback', e);
			beacon_entry_fallback(e);
		},
		navStarted(e) {
			record_hook('navStarted', e);
		},
		navigated(e) {
			record_hook('navigated', e);
			beacon_nav(e);
		},
		criticalSettled(e) {
			record_hook('criticalSettled', e);
			beacon_critical(e);
		},
		loadStarted(e) {
			record_hook('loadStarted', e);
		},
		warning(e) {
			record_hook('warning', e);
			beacon_warning(e);
		}
	}
};

const client: ClientPlugin = defineClient(plugin);

export default client;
