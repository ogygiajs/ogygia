/**
 * KIT'S `asset()` FOR OGYGIA'S URLS. ogygia bakes every URL base-less with a leading slash
 * (`/_app/immutable/…`, `/@id/…`) and runs it through Kit's `asset()` at render — the one authority on
 * the base, the assets CDN and page-relative paths. Kit 2 takes the path with its leading slash; Kit 3
 * takes it without (and warns on every call with it, in dev — one warning per island render).
 *
 * WHICH KIT is a build-time fact: the plugin reads the app's Kit and defines `__OGYGIA_KIT_MAJOR__`. It
 * used to be probed (try the path without its slash; a refusal means Kit 2) — but Kit 2 refuses only in
 * DEV: in a build it accepted the slash-less path and returned it page-relative (`_app/immutable/x.js`),
 * so on a page below the root every island entry resolved against the page (`/account/_app/…`) and 404'd.
 * Without the define (a plain node import of dist/), the probe stands in, its answer checked: a result
 * that is neither root-absolute, page-relative with a dot, nor a full URL is Kit 2's slash-less mistake.
 */
import { asset } from '$app/paths';

const KIT_MAJOR = typeof __OGYGIA_KIT_MAJOR__ !== 'undefined' ? __OGYGIA_KIT_MAJOR__ : null;

/** this Kit wants the leading slash (it refused the path without one); null until the first call */
let wants_slash: boolean | null = KIT_MAJOR === null ? null : KIT_MAJOR < 3;

/** A URL `asset()` may legitimately return: root-absolute, `./` / `../` relative, or a full URL. */
function well_formed(url: string): boolean {
	return url.startsWith('/') || url.startsWith('.') || url.includes('://');
}

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

/** Kit's `asset()` for a base-less URL ogygia baked (`/_app/immutable/x.js`). */
export function kit_asset(file: string): string {
	const call = asset as (f: string) => string;
	if (!file.startsWith('/')) return call(file);
	if (wants_slash === null) {
		try {
			const out = call(file.slice(1));
			if (well_formed(out)) {
				wants_slash = false;
				return out;
			}
		} catch {
			// ok: Kit 2 in dev refuses it; the fallback below answers
		}
		wants_slash = true;
	}
	return call(wants_slash ? file : file.slice(1));
}
