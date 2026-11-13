import path from 'node:path';

/** The fixed-name map's file, in the app dir (beside Kit's `version.json`). */
export const CURRENT_LOCATIONS_FILE = 'ogygia.json';

function relative_specifier(from_file: string, to_file: string): string {
	const rel = path.posix.relative(path.posix.dirname(from_file), to_file);
	return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Orders `[key, value]` pairs by key: what the build writes from the bundler's entries, which it
 *  emits in no stable order, is written in one order every build (#490). */
export function by_key(a: readonly [string, unknown], b: readonly [string, unknown]): number {
	return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
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
 *
 * An island's identity (`<appDir>/ogygia/og-region.<iid>.js`) is a name, not a file; its location
 * is a content-hashed file under `immutable/`. The same map is written twice:
 * `<appDir>/immutable/og-locations.<hash>.json`, named by its content, which the runtime's script
 * names (`data-og-locations`) for this build's page; and `<appDir>/ogygia.json` at the one fixed
 * name, beside Kit's `version.json`, which a page that outlived its build reads to wake on the
 * current code. Both sides of each pair are relative to the file holding them, so the browser
 * resolves them against wherever the build is served.
 */
export function location_map_files(
	app_dir: string,
	pairs: Iterable<readonly [string, string]>,
	hash: (source: string) => string
): { fileName: string; source: string }[] {
	const list = [...pairs].sort(by_key);
	if (!list.length) return [];
	const hashed_dir = `${app_dir}/immutable`;
	const hashed_source = map_source(`${hashed_dir}/og-locations.json`, list);
	const current = `${app_dir}/${CURRENT_LOCATIONS_FILE}`;
	return [
		{ fileName: `${hashed_dir}/og-locations.${hash(hashed_source)}.json`, source: hashed_source },
		{ fileName: current, source: map_source(current, list) }
	];
}
