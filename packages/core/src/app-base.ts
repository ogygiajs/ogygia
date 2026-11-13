declare const __SVELTEKIT_PATHS_BASE__: string;
/** The app's configured `paths.base` (`''` or `/x`), absolute: Kit's build define. Kit's `base` and
 *  `resolve()` answer relative to the page being rendered under `paths.relative` (its default). */
const APP_BASE: string =
	typeof __SVELTEKIT_PATHS_BASE__ !== 'undefined' ? __SVELTEKIT_PATHS_BASE__ : '';

/**
 * A path on the app's own origin, from the root (`/shop/__ogygia__`), for an address that travels in
 * HTML that moves: a hole's answer lands in a page at another depth, a peer's widget in another app,
 * a fetched page in the document. Never page-relative, whatever `paths.relative` says
 * (test/capability-relative-paths.test.ts, the server rule `rule_capability_not_path`).
 */
export function app_path(path: string): string {
	return APP_BASE + path;
}
