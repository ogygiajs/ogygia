/**
 * THE NAVIGATION HANDLE — how ISLAND-SIDE code (the `$app/navigation` shim, `ogygia/app`, the
 * remote-functions client stub, the lifecycle hooks) reaches the running runtime's navigation
 * WITHOUT importing a runtime module.
 *
 * Why not just import the router: island code is bundled apart from the runtime (an island chunk
 * can load on a csr=true page where the runtime never boots). A runtime module island code imports
 * is SHARED between the two graphs, so the bundler must keep it out of the runtime chunk — and with
 * it everything that module's own lazy chunks need. One `import … from '../runtime/router.ts'` in the
 * navigation shim split the runtime's boot into a dozen files. So island code reads this handle
 * from the global realm (the same pattern as the Kit page bridge, `Symbol.for('ogygia.kit-page')`),
 * and `test/runtime-boot-svelte-free.test.ts` pins that no island-side module imports a boot module.
 *
 * Who publishes it, on a document ogygia boots:
 * - the ROUTER feature (./router.ts `install`) — the SPA router's API;
 * - otherwise the `mpa-nav` feature ({@link install}) publishes {@link mpa_nav}: the browser
 *   navigates, preloads become Speculation Rules hints, and `invalidateAll` is still the soft seed
 *   refresh (./router-nav.ts, loaded on first use) — exactly what `router: false` apps got before.
 *   Installed only when island code can reach the handle (the `page` mark: `$app/navigation`,
 *   `ogygia/app`, or anything the build could not follow): with none of those, nothing reads it.
 *
 * Island code reads it as `globalThis[Symbol.for('ogygia.nav')]` (the key is repeated there on
 * purpose: importing {@link NAV_HANDLE_KEY} would be the very edge this module exists to avoid).
 */
import { flights, STALE } from '@ogygia/machine';
import { import_again } from './import-again.ts';
import { speculate_url } from './speculate-hint.ts';
import { OgygiaError, warn } from '../messages/core.ts';
import { download } from '../policies.ts';
import type { AfterNavigateCallback, BeforeNavigateCallback } from './router.ts';

export const NAV_HANDLE_KEY: unique symbol = Symbol.for('ogygia.nav');

/**
 * THE SOFT REFRESH (./router-nav.ts `invalidate_all`), loaded once, on the first refresh. A
 * download that fails is tried again at once, and a failure is never kept: the next refresh loads
 * it afresh, under a fresh URL (./import-again.ts: the browser keeps the failed one). It once
 * imported the same URL again, which fails at once for the life of the page. Only the refresh is
 * read from the module, so the bundler leaves the rest of the navigation out of its chunk in an app
 * without the router; a retry reads the same part from the file (@ogygia/compiler vite/lazy-files.ts hands the
 * loader its file).
 */
const load_refresh = flights({
	name: 'soft refresh',
	run: import_again(
		() => import('./router-nav.ts').then(({ invalidate_all }) => ({ invalidate_all })),
		(url) =>
			(import(/* @vite-ignore */ url) as Promise<typeof import('./router-nav.ts')>).then(
				({ invalidate_all }) => ({ invalidate_all })
			)
	),
	retry: download
});
/** The refresh, once its module is in (never STALE: nothing drops it). */
const invalidate_all = (): Promise<void> =>
	load_refresh.get().then((n) => (n === STALE ? undefined : n.invalidate_all()));

export type NavHandle = {
	goto(url: string | URL, opts?: { replaceState?: boolean; external?: boolean }): Promise<void>;
	invalidate(): Promise<void>;
	invalidateAll(): Promise<void>;
	preloadData(url: string | URL): Promise<unknown>;
	preloadCode(url?: string | URL): Promise<void>;
	disableScrollHandling(): void;
	pushState(): void;
	replaceState(): void;
	beforeNavigate(fn: BeforeNavigateCallback): () => void;
	afterNavigate(fn: AfterNavigateCallback): () => void;
	bust_page_cache(): void;
};

/** Feature entry (`mpa-nav`, boot phase): the MPA handle, first — the router's install, later in
 *  the feature order, replaces it. */
export function install(): void {
	if (typeof document !== 'undefined' && !(NAV_HANDLE_KEY in globalThis)) publish_nav(mpa_nav());
}

/** Publish the document's navigation handle (the router's replaces the MPA one). */
export function publish_nav(handle: NavHandle): void {
	(globalThis as unknown as Record<symbol, NavHandle>)[NAV_HANDLE_KEY] = handle;
}

const NO_UNSUBSCRIBE = () => {};

/**
 * The handle when the router feature is not in this runtime (`router: false`): the browser owns
 * navigation. Same contract the router's own functions had for that case.
 */
export function mpa_nav(): NavHandle {
	return {
		goto(url, opts = {}) {
			const target = new URL(url, location.href);
			if (target.protocol !== 'http:' && target.protocol !== 'https:') {
				throw new OgygiaError('goto_not_http');
			}
			if (target.origin !== location.origin && !opts.external) {
				throw new OgygiaError('goto_cross_origin');
			}
			if (opts.replaceState) location.replace(target.href);
			else location.assign(target.href);
			return Promise.resolve();
		},
		// No SPA cache to bust, but the page's seeds can still refresh in place.
		invalidate: invalidate_all,
		invalidateAll: invalidate_all,
		preloadData(url) {
			speculate_url(url, 'prerender');
			return Promise.resolve({ type: 'loaded' as const, status: 200, data: {} });
		},
		preloadCode(url) {
			if (url != null) speculate_url(url, 'prefetch');
			return Promise.resolve();
		},
		disableScrollHandling() {},
		pushState() {
			warn('shallow_routing_unsupported', { method: 'pushState' });
		},
		replaceState() {
			warn('shallow_routing_unsupported', { method: 'replaceState' });
		},
		// No client-side navigations happen without the router: nothing to notify.
		beforeNavigate: () => NO_UNSUBSCRIBE,
		afterNavigate: () => NO_UNSUBSCRIBE,
		bust_page_cache() {}
	};
}
