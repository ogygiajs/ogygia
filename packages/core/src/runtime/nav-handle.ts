import { flights, STALE } from '@ogygia/machine';
import { import_again } from './import-again.ts';
import { code_url_or_refuse, import_code } from './code-origins.ts';
import { speculate_url } from './speculate-hint.ts';
import { OgygiaError, warn } from '../messages/core.ts';
import { download } from '../policies.ts';
import type { AfterNavigateCallback, BeforeNavigateCallback } from './router.ts';

/**
 * Where the document's navigation handle lives: how island-side code (the `$app/navigation` shim,
 * `ogygia/app`, the remote-functions stub, the lifecycle hooks) reaches the runtime's navigation
 * without importing a runtime module. Island code is bundled apart from the runtime, and a module
 * both graphs import is pulled out of the boot chunk with everything it loads, so island code
 * repeats this key instead of importing it (test/runtime-boot-svelte-free.test.ts pins that no
 * island-side module imports a boot module). The router feature publishes the SPA router's API;
 * otherwise the `mpa-nav` feature publishes {@link mpa_nav}.
 */
export const NAV_HANDLE_KEY: unique symbol = Symbol.for('ogygia.nav');

const load_refresh = flights({
	name: 'soft refresh',
	run: import_again(
		() => import('./router-nav.ts').then(({ invalidate_all }) => ({ invalidate_all })),
		(url) =>
			Promise.resolve()
				.then(() => import_code<typeof import('./router-nav.ts')>(code_url_or_refuse(url)))
				.then(({ invalidate_all }) => ({ invalidate_all }))
	),
	retry: download
});
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

/** Feature entry (`mpa-nav`, boot phase): the MPA handle, first. The router's install, later in
 *  the feature order, replaces it, and a later call never replaces the router's. The build adds the
 *  feature only when island code can reach the handle (the `page` mark). */
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
 * navigation, and preloads become Speculation Rules hints. `invalidate` and `invalidateAll` are the
 * soft seed refresh (./router-nav.ts), loaded on the first refresh: a failed download is tried
 * again at once and never kept, so the next refresh loads it under a fresh URL (#238). No
 * client-side navigation happens, so `beforeNavigate` and `afterNavigate` never fire.
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
		beforeNavigate: () => NO_UNSUBSCRIBE,
		afterNavigate: () => NO_UNSUBSCRIBE,
		bust_page_cache() {}
	};
}
