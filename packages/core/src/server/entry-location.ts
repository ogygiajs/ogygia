/**
 * ENTRY IDENTITY → LOCATION, on the server. A hydrate island's entry and the runtime each have an
 * IDENTITY — the stable URL the compiler bakes (`/<appDir>/ogygia/og-region.<iid>.js`, the
 * runtime's stable name) and every map keys by — and a LOCATION: the content-hashed file the build
 * emitted under `immutable/`, the one a browser loads. A hashed name cannot go stale; the stable name
 * lives outside `immutable/` (compiler/region/transform.ts `STABLE_NAME_DIR`), so a host revalidates
 * it. The server bundle is built before the client bundle, so the location is looked up at render
 * time through the build handoff (`entryLocation`).
 *
 * No location (the dev server, a handoff from before hashing, an island from another app): the
 * identity itself is written — in a build a name, no file: the browser finds the current file through
 * the build's location maps (compiler/link/location-map.ts).
 */
import runtime_url from 'virtual:ogygia/runtime-url';
import { entryLocation, islandDeps, locationMap } from 'virtual:ogygia/island-deps';
import { runtime_bootstrap_tags } from './document-tail.ts';

/** The file an entry is loaded from: its content-hashed location, else the identity itself. */
export function entry_src(identity: string): string {
	return (identity && entryLocation(identity)) || identity;
}

/**
 * The runtime bootstrap for a document: the runtime's script (its location) and a preload per chunk
 * it statically imports, so they download with it. `resolve` applies the base / assets prefix (Kit's
 * `asset()`); a routeless document passes none. Empty when no runtime is built.
 */
export function runtime_bootstrap(resolve: (url: string) => string = (url) => url): string {
	if (!runtime_url) return '';
	const map = locationMap();
	return runtime_bootstrap_tags(
		resolve(entry_src(runtime_url)),
		islandDeps(runtime_url).map(resolve),
		map ? resolve(map) : null
	);
}
