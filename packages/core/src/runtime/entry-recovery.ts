/**
 * THE CURRENT BUILD'S MAP (compiler/link/location-map.ts): the one file at a fixed name, in the app
 * dir of the identities it maps (`<appDir>/ogygia.json`), so any app's is found from an identity alone.
 * A page that outlived its build reads it when its own files are gone (or it never named a map) and
 * wakes on the current code. Revalidated (a host serves it as any changing file; `no-cache` past one
 * that kept it anyway), read once per document per app. Only an ogygia identity has one: the dev
 * server's module URLs never ask.
 *
 * Loaded on the first load that needs it (./entry-locations.ts): a page whose files all load never
 * downloads it. Self-contained, so it pulls nothing of the boot into its chunk.
 */
const current_maps = new Map<string, Promise<Record<string, string> | null>>();

const absolute = (url: string, base: string = location.href): string => {
	try {
		return new URL(url, base).href;
	} catch {
		return url;
	}
};

/** The current map's file for an identity (`<appDir>/ogygia.json`), or null: not a build's identity. */
function current_map_file(identity: string): string | null {
	const dir = identity.lastIndexOf('/ogygia/og-region.');
	return dir === -1 ? null : identity.slice(0, dir) + '/ogygia.json';
}

/** The current build's location for `entry`: null when its map has none, undefined when the map
 *  could not be read (that read is not kept: the next ask reads again). */
export async function current_location(entry: string): Promise<string | null | undefined> {
	const identity = absolute(entry);
	const file = current_map_file(identity);
	if (!file) return null;
	let map = current_maps.get(file);
	if (!map) {
		map = fetch(file, { cache: 'no-cache' })
			.then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : null))
			.catch(() => null);
		current_maps.set(file, map);
	}
	const pairs = await map;
	if (!pairs) {
		forget_current_map(file, map);
		return undefined;
	}
	for (const name in pairs)
		if (absolute(name, file) === identity) return absolute(pairs[name], file);
	return null;
}

function forget_current_map(file: string, map = current_maps.get(file)): void {
	if (current_maps.get(file) === map) current_maps.delete(file);
}

/** The host says this file is not there (it does not say so of a file that failed another way). */
function is_gone(url: string): Promise<boolean> {
	return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(
		(res) => res.status === 404 || res.status === 410,
		() => false
	);
}

/** How long a recovery waits before each ask of the current map: a rollover settles in seconds. */
const RECOVERY_WAITS = [0, 1000, 3000, 9000];

/**
 * The current build's file for a build's identity whose file just failed to load. A deploy's rollover
 * is exactly when this is asked, so an answer that cannot be the current one is asked again while it
 * settles: a map that could not be read (a 404, a 5xx), and a map that names the very file that just
 * failed when the host says that file is gone — an edge still answering with the old build's map. A
 * file that failed some other way (the network, a broken module) is not asked about again.
 */
export async function recover_location(entry: string, failed: string): Promise<string | null> {
	let current: string | null | undefined;
	for (const wait of RECOVERY_WAITS) {
		if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
		current = await current_location(entry);
		if (current === undefined) continue;
		if (current !== failed || !(await is_gone(failed))) break;
		forget_current_map(current_map_file(absolute(entry))!);
	}
	return current ?? null;
}
