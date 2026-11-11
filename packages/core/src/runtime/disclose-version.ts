const VERSION = typeof __OGYGIA_VERSION__ !== 'undefined' ? __OGYGIA_VERSION__ : null;

/**
 * Which ogygia this page is on: adds the runtime's full version (the plugin defines it from the
 * installed package) to `window.__ogygia.v`, as Svelte does with `window.__svelte.v`. A Set, since
 * a page can run more than one ogygia (a federated fragment brings its own app's runtime).
 */
export function disclose_version(): void {
	if (typeof window === 'undefined' || !VERSION) return;
	const own = window as unknown as { __ogygia?: { v?: Set<string> } };
	((own.__ogygia ??= {}).v ??= new Set()).add(VERSION);
}
