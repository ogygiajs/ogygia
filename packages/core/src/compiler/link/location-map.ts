/**
 * THE LOCATION MAPS. Island entries are content-hashed files under `immutable/`; an island's IDENTITY
 * (`<appDir>/ogygia/og-region.<iid>.js`, the name every key uses) is a name, not a file. The build
 * writes its identity → location pairs twice, as the same map:
 *
 *  - `<appDir>/immutable/og-locations.<hash>.json`, named by its content. The runtime's script names
 *    it (`data-og-locations`), and a load that arrives with an identity alone (a region the browser
 *    rendered, a held region from the wire, a portable snippet) reads it: this build's locations, for
 *    this build's page.
 *  - `<appDir>/ogygia.json`, the ONE file at a fixed name: the current build's, beside Kit's own
 *    `<appDir>/version.json` and found from an identity alone (its app dir is the identity's, so any
 *    app's is found). A page that outlived its build reads it when its own files are gone, and wakes
 *    on the current code. Outside `immutable/`: a host revalidates it, as it does Kit's.
 *
 * Every other file the build writes is named by its content and lives in `immutable/`, so a host's
 * year-long rule fits all of them; no directory of ogygia's own is written (`ogygia/` in an identity
 * is a name). Both sides of each pair are written relative to the file holding them: the browser
 * resolves them against wherever the build is served (a base, an assets CDN), and an identity that
 * resolves elsewhere (another app's) never matches.
 */
import path from 'node:path';

/** The fixed-name map's file, in the app dir (beside Kit's `version.json`). */
export const CURRENT_LOCATIONS_FILE = 'ogygia.json';

/** A path from `from_file`'s directory to `to_file` (both output-relative), always dot-led. */
function relative_specifier(from_file: string, to_file: string): string {
	const rel = path.posix.relative(path.posix.dirname(from_file), to_file);
	return rel.startsWith('.') ? rel : './' + rel;
}

function map_source(file: string, pairs: readonly (readonly [string, string])[]): string {
	const map: Record<string, string> = {};
	for (const [identity, location] of pairs)
		map[relative_specifier(file, identity)] = relative_specifier(file, location);
	return JSON.stringify(map);
}

/**
 * Both maps, as output files: the content-hashed one first. `pairs`: identity file → hashed file,
 * output-relative. Empty when there is nothing to map.
 */
export function location_map_files(
	app_dir: string,
	pairs: Iterable<readonly [string, string]>,
	hash: (source: string) => string
): { fileName: string; source: string }[] {
	const list = [...pairs];
	if (!list.length) return [];
	const hashed_dir = `${app_dir}/immutable`;
	const hashed_source = map_source(hashed_dir + '/og-locations.json', list);
	const current = `${app_dir}/${CURRENT_LOCATIONS_FILE}`;
	return [
		{ fileName: `${hashed_dir}/og-locations.${hash(hashed_source)}.json`, source: hashed_source },
		{ fileName: current, source: map_source(current, list) }
	];
}
