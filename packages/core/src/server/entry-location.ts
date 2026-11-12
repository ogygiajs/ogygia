/**
 * ENTRY IDENTITY → LOCATION, on the server. A hydrate island's entry and the runtime each have an
 * IDENTITY — the stable URL the compiler bakes (`/<appDir>/ogygia/og-region.<iid>.js`, the
 * runtime's stable name) and every map keys by — and a LOCATION: the content-hashed file the build
 * emitted under `immutable/`, the one a browser loads. A hashed name cannot go stale; the stable name
 * lives outside `immutable/` (compiler/region/transform.ts `STABLE_NAME_DIR`), so a host revalidates
 * it. The server bundle is built before the client bundle, so the location is looked up at render
 * time through the build handoff (`entry_location`).
 *
 * In dev the identity is the location (the dev server serves the module at it). No location in a
 * build (a handoff from before hashing, an island from another app): a region writes no `src`, and the
 * browser finds the current file through the build's location maps (compiler/link/location-map.ts).
 */
import { runtime_url, entry_location, region_deps, location_map } from 'ogygia:server';
import { runtime_bootstrap_tags } from './document-tail.ts';
import { code_origins } from '../plugin/hooks.ts';

/** The file an entry is loaded from: its content-hashed location, else the identity itself. */
export function entry_src(identity: string): string {
	return (identity && entry_location(identity)) || identity;
}

/**
 * The runtime bootstrap for a document: the runtime's script (its location) and a preload per chunk
 * it statically imports, so they download with it. `resolve` applies the base / assets prefix (Kit's
 * `asset()`); a routeless document passes none. Empty when no runtime is built.
 */
export function runtime_bootstrap(resolve: (url: string) => string = (url) => url): string {
	if (!runtime_url) return '';
	const map = location_map();
	return runtime_bootstrap_tags(
		resolve(entry_src(runtime_url)),
		region_deps(runtime_url).map(resolve),
		map ? resolve(map) : null,
		// (the code origins plugins add: a federation shell's peers, runtime/code-origins.ts)
		code_origins()
	);
}
