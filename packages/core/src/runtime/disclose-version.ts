/**
 * WHICH OGYGIA IS THIS PAGE ON: the runtime adds its version to `window.__ogygia.v`, a Set, as
 * Svelte does with `window.__svelte.v`. A Set because a page can run more than one ogygia (a
 * federated fragment brings its own app's runtime). The full version, not just the major: telling
 * one release line from another is the point. The plugin defines it from the installed package.
 */
const VERSION = typeof __OGYGIA_VERSION__ !== 'undefined' ? __OGYGIA_VERSION__ : null;

export function disclose_version(): void {
	if (typeof window === 'undefined' || !VERSION) return;
	const own = window as unknown as { __ogygia?: { v?: Set<string> } };
	((own.__ogygia ??= {}).v ??= new Set()).add(VERSION);
}
