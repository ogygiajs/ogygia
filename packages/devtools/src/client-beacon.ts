/**
 * The BROWSER half of `devtools({ dock: false })`: the profiler's beacon alone, so the build keeps only
 * the runtime hooks the beacon reads. With the dock on, `client.ts` is the realm, and it calls these.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import type { RuntimeHooks } from '@ogygia/core/plugin/client';
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

export const on_region_hydrated: RuntimeHooks['regionHydrated'] = (e) =>
	beacon_hydrated(e.el, e.t0, e.tLoaded, e.tDone, e.ssrHtml, e.tTurn);
export const on_region_failed: RuntimeHooks['regionFailed'] = (e) =>
	beacon_failed(e.el, e.message, e.since, e.turn);
export const on_hole_answered: RuntimeHooks['holeAnswered'] = (e) =>
	beacon_hole_answered(e.el, e.start, e.batch);
export const on_hole_failed: RuntimeHooks['holeFailed'] = ({ el: _el, finalPath, ...h }) =>
	beacon_hole_failed({ ...h, ...(finalPath ? { final_path: finalPath } : {}) });
export const on_hole_batch_missed: RuntimeHooks['holeBatchMissed'] = ({ finalUrl, ...m }) =>
	beacon_hole_batch_missed({ ...m, ...(finalUrl ? { final_url: finalUrl } : {}) });

// (named, so `boot` keeps one id however the rest of this file changes)
const plugin: ClientPlugin = {
	boot() {
		install_beacon(false);
	},
	hooks: {
		regionHydrated: on_region_hydrated,
		regionFailed: on_region_failed,
		holeAnswered: on_hole_answered,
		holeFailed: on_hole_failed,
		holeBatchMissed: on_hole_batch_missed,
		entryFallback: beacon_entry_fallback,
		navigated: beacon_nav,
		criticalSettled: beacon_critical,
		warning: beacon_warning
	}
};

const client: ClientPlugin = defineClient(plugin);

export default client;
