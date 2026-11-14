/**
 * The BROWSER half of `devtools()` with the dock on: the realm (realm.ts: the hook record the dock's
 * readers read, the profiler's beacon, the leftovers watch) and the dock's launcher.
 * `devtools({ dock: false })` registers client-beacon.ts instead, so its build keeps the beacon's
 * hooks alone.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import { devtools_switched_on } from '@ogygia/core/internal/instruments';
import { install_devtools_ui } from './devtools/ui.ts';
import { install_beacon } from './profiler/beacon.ts';
import { standalone_beacon } from './profiler/beacon-standalone.ts';
import { realm_boot, realm_hook } from './realm.ts';
import { start_page_beacon } from './page-beacon-start.ts';

const BEACON_KEY = Symbol.for('ogygia.beacon');
const LAZY = typeof __OGYGIA_DEVTOOLS_LAZY__ !== 'undefined' ? __OGYGIA_DEVTOOLS_LAZY__ : false;

// (named, so `boot` and each hook keep one id however the rest of this file changes)
const plugin: ClientPlugin = {
	boot({ kitPage }) {
		// @why the dev dock measures every document, and an app without ogygia's handle gets no beacon tag from the server (test: e2e/dev-installed.spec.ts › two copies)
		if (!LAZY) standalone_beacon();
		// one mounted Svelte app (launcher + tabbed window), starting hidden (Alt+O); a pure bus/DOM
		// consumer. First: in a build it applies the URL's switch, which the leftovers watch reads
		install_devtools_ui(kitPage ? { csr_true: true } : undefined);
		realm_boot(kitPage, {
			dev: import.meta.env.DEV,
			lend: () => import('./devtools/realm-loan.ts')
		});
		// @why a build's dock measures a switched-on browser, and an app without ogygia's handle gets no beacon tag; a lazy chunk, so other builds pay nothing (test: e2e/dock-switch.spec.ts › the page beacon in a build)
		if (LAZY && devtools_switched_on() && !(globalThis as Record<symbol, unknown>)[BEACON_KEY])
			// oxlint-disable-next-line ogygia/no-silent-failures -- it never rejects (a failed download is warned inside)
			void start_page_beacon().then((started) => {
				// (the regions' half joins the beacon now that there is one)
				if (started) install_beacon(true);
			});
	},
	hooks: {
		regionMount: (e) => realm_hook('regionMount', e),
		regionUnmount: (e) => realm_hook('regionUnmount', e),
		regionHydrated: (e) => realm_hook('regionHydrated', e),
		regionFailed: (e) => realm_hook('regionFailed', e),
		regionWoke: (e) => realm_hook('regionWoke', e),
		regionMismatched: (e) => realm_hook('regionMismatched', e),
		holeAnswered: (e) => realm_hook('holeAnswered', e),
		holeFailed: (e) => realm_hook('holeFailed', e),
		holeBatchMissed: (e) => realm_hook('holeBatchMissed', e),
		entryFallback: (e) => realm_hook('entryFallback', e),
		navStarted: (e) => realm_hook('navStarted', e),
		navigated: (e) => realm_hook('navigated', e),
		criticalSettled: (e) => realm_hook('criticalSettled', e),
		loadStarted: (e) => realm_hook('loadStarted', e),
		warning: (e) => realm_hook('warning', e)
	}
};

const client: ClientPlugin = defineClient(plugin);

export default client;
