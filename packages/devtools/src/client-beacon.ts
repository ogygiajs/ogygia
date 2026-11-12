/**
 * The BROWSER half of `devtools({ dock: false })`: the profiler's beacon alone, so the build keeps only
 * the runtime hooks the beacon reads. With the dock on, the realm (realm.ts) calls `beacon_hook`.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import type { RuntimeHookName, RuntimeHooks } from '@ogygia/core/plugin/client';
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
import { first_handling } from './devtools/hook-once.ts';

type Payload<K extends RuntimeHookName> = Parameters<RuntimeHooks[K]>[0];

/** What the beacon's regions half hears, by hook. */
const BEACON_HOOKS: { [K in RuntimeHookName]?: (e: Payload<K>) => void } = {
	regionHydrated: (e) => beacon_hydrated(e.el, e.t0, e.tLoaded, e.tDone, e.ssrHtml, e.tTurn),
	regionFailed: (e) => beacon_failed(e.el, e.message, e.since, e.turn),
	holeAnswered: (e) => beacon_hole_answered(e.el, e.start, e.batch),
	holeFailed: ({ el: _el, finalPath, ...h }) =>
		beacon_hole_failed({ ...h, ...(finalPath ? { final_path: finalPath } : {}) }),
	holeBatchMissed: ({ finalUrl, ...m }) =>
		beacon_hole_batch_missed({ ...m, ...(finalUrl ? { final_url: finalUrl } : {}) }),
	entryFallback: beacon_entry_fallback,
	navigated: beacon_nav,
	criticalSettled: beacon_critical,
	warning: beacon_warning
};

/** One hook call into the beacon, once per page whichever plugin's copy hears it first. */
export function beacon_hook<K extends RuntimeHookName>(name: K, e: Payload<K>): void {
	const f = BEACON_HOOKS[name];
	if (f && first_handling('beacon', e)) f(e);
}

// (named, so `boot` keeps one id however the rest of this file changes)
const plugin: ClientPlugin = {
	boot() {
		install_beacon(false);
	},
	hooks: {
		regionHydrated: (e) => beacon_hook('regionHydrated', e),
		regionFailed: (e) => beacon_hook('regionFailed', e),
		holeAnswered: (e) => beacon_hook('holeAnswered', e),
		holeFailed: (e) => beacon_hook('holeFailed', e),
		holeBatchMissed: (e) => beacon_hook('holeBatchMissed', e),
		entryFallback: (e) => beacon_hook('entryFallback', e),
		navigated: (e) => beacon_hook('navigated', e),
		criticalSettled: (e) => beacon_hook('criticalSettled', e),
		warning: (e) => beacon_hook('warning', e)
	}
};

const client: ClientPlugin = defineClient(plugin);

export default client;
