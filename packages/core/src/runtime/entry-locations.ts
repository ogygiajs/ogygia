/**
 * ENTRY IDENTITY → LOCATION, the browser's half (server/entry-location.ts is the server's).
 *
 * An island's `entry` is its IDENTITY: the stable URL every key uses (the island graph, the
 * fingerprint, the devtools' names). The file to import is its LOCATION — content-hashed, so an
 * `immutable` cache never serves a stale one. The server writes it beside the identity: the region
 * element's `src`, and the island graph's `s` map for an entry no element carries (a portable
 * snippet's), and the build's location maps for the rest (`import_entry`). Every loader resolves
 * through `island_module_url` (region-endpoint-url.ts), which asks here first: the location once one
 * is known, else the identity (on the dev server, the module itself; in a build, a name, no file).
 */
import { import_file } from './import-again.ts';
import { code_url_or_refuse, is_location_of } from './code-origins.ts';
import { backoffAfter, cache, flights, net, scope, STALE } from '@ogygia/machine';
import { rollover } from '../policies.ts';
import { OG_LOCATIONS } from '../wire-markup.ts';

/** absolute identity → absolute location: the islands of the pages this document has seen (a build
 *  names a few hundred; the least recently read go first past this, and are found again) */
const locations = cache<string, string>({ name: 'entry locations', max: 10_000 });

/** A load that fell back to its identity: who hears about it (the runtime registers the devtools
 *  and beacon reporter at boot). This module imports nothing: app code (a portable snippet) uses it
 *  too, and must not pull the runtime's reporting into the app's chunks. */
export type EntryFallbackReport = { entry: string; src: string; recovered: boolean };
let fallback_reporter: ((report: EntryFallbackReport) => void) | null = null;
export function on_entry_fallback(reporter: (report: EntryFallbackReport) => void): void {
	fallback_reporter = reporter;
}

/** Resolved URLs by base + url: every wake, warm and graph read asks again for the same few
 *  entries, and each ask was a `new URL()` parse (the least recently asked go first). */
const resolved_urls = cache<string, string>({ name: 'resolved entry urls', max: 4000 });

function absolute(url: string, base?: string): string {
	const b = base ?? location.href;
	const key = `${b}\n${url}`;
	const hit = resolved_urls.get(key);
	if (hit !== undefined) return hit;
	let out: string;
	try {
		out = new URL(url, b).href;
	} catch {
		out = url; // ok: not a URL: kept as written
	}
	resolved_urls.set(key, out);
	return out;
}

/** Remember where an entry is served from. `base`: the document the pair was read from. Only the
 *  same island's built file on an allowed origin is kept (./code-origins.ts `is_location_of`): one
 *  element's `src` must not re-point the code of every region with its identity. */
export function note_entry_location(
	entry: string | null | undefined,
	src: string | null | undefined,
	base?: string
): void {
	if (!entry || !src || src === entry) return;
	set_location(absolute(entry, base), absolute(src, base));
}

/** The one write into the map: a pair that is not an identity and its own file is dropped. */
function set_location(identity: string, location: string, only_new = false): void {
	if (only_new && locations.has(identity)) return;
	if (is_location_of(identity, location)) locations.set(identity, location);
}

/** The known location of an entry, or undefined. */
export function entry_location(entry: string, base?: string): string | undefined {
	return locations.size ? locations.get(absolute(entry, base)) : undefined;
}

/**
 * THIS BUILD'S LOCATION MAP (compiler/link/location-map.ts, the content-hashed one): every island entry's
 * location by identity, for a load that arrives with an identity alone — a region the browser
 * rendered, a held region from the wire, a snippet whose host carried no graph. The runtime's script
 * names it (`data-og-locations`); it is read once, on the first such load. Content-hashed, so no
 * cache serves it stale. It only fills gaps: a location a page wrote (a later build's, after a
 * navigation) always wins over the map of the build the runtime came from. No map, or it failed
 * (the dev server, a page that outlived its build): the identity is loaded, as before. A failed read
 * is not kept: the next identity-only load asks again (a blip must not cost the page every later one).
 */
// (one local name for the five reads: the minifier keeps the string once)
const BUILD_MAP_ATTR = OG_LOCATIONS;
/** The map's read: whether it filled the locations. One read at a time, kept once it did. */
const build_map = flights({
	name: 'build location map',
	run: (url: string) =>
		net // ok: a map that could not be read is not kept: the next load asks again, and loads keep their stable URLs meanwhile
			.fetch(url)
			.then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : null))
			.catch(() => null)
			.then((map) => {
				if (!map) return false;
				for (const stable in map)
					set_location(absolute(stable, url), absolute(map[stable], url), true);
				return true;
			}),
	keep: (filled) => (filled ? Infinity : 0)
});

/**
 * Pin the build map's address to the page that wrote it, as `pin_region_urls` pins a region's: with
 * Kit's default `paths.relative` it is written relative to that page, and it is read lazily — after a
 * client navigation to another depth, resolved against the new address, it named a file that is not
 * there. The runtime calls this at boot, before any navigation.
 */
export function pin_build_map(): void {
	if (typeof document === 'undefined') return;
	const script = document.querySelector(`script[${BUILD_MAP_ATTR}]`);
	const href = script?.getAttribute(BUILD_MAP_ATTR);
	if (script && href) script.setAttribute(BUILD_MAP_ATTR, absolute(href));
}

function read_build_map(): Promise<unknown> | null {
	if (typeof document === 'undefined') return null;
	const href = document.querySelector(`script[${BUILD_MAP_ATTR}]`)?.getAttribute(BUILD_MAP_ATTR);
	if (!href) return null;
	return build_map.get(absolute(href));
}

/** The region attributes that hold a URL: its identity, its location, its hole's endpoint. */
const REGION_URL_ATTRS = ['entry', 'src', 'endpoint'] as const;

/**
 * PIN A REGION'S URLS TO THE PAGE THAT WROTE THEM. With Kit's default `paths.relative`, the server
 * writes `entry` / `src` / `endpoint` relative to the page it rendered (`../../_app/immutable/…`,
 * `../../__ogygia__?…`), and every reader resolves them against `location.href`. A region that stays
 * on the page through a client navigation (Kit's, or the router's) then resolved them against the
 * NEW address: its island imported `/a/b/_app/…` (a redirect to an HTML page), and a hole's key
 * changed with the depth of the page, so a swap kept the old region beside the new one. Resolved
 * once, where the address is still the right one — the element's connect, and a fetched document
 * against its own URL — they read the same on every page. Same origin only (a federated entry stays
 * as written); an absolute or root-absolute value is already pinned.
 */
export function pin_region_urls(el: Element, base?: string): void {
	for (const name of REGION_URL_ATTRS) {
		const value = el.getAttribute(name);
		if (!value || !(value.startsWith('./') || value.startsWith('../'))) continue;
		let url: URL;
		try {
			url = new URL(absolute(value, base));
		} catch {
			continue; // ok: not a URL: the attribute stays as written
		}
		if (url.origin === location.origin) el.setAttribute(name, url.pathname + url.search + url.hash);
	}
}

/** An island element's identity, its location noted on the way (the one read every loader uses). */
export function island_entry_of(el: Element): string | null {
	const entry = el.getAttribute('entry');
	if (entry) note_entry_location(entry, el.getAttribute('src'));
	return entry;
}

/**
 * THE CURRENT BUILD'S MAP (compiler/link/location-map.ts): the one file at a fixed name, in the app
 * dir of the identities it maps (`<appDir>/ogygia.json`), so any app's is found from an identity alone.
 * A page that outlived its build reads it when its own files are gone (or it never named a map) and
 * wakes on the current code. Revalidated (a host serves it as any changing file; `no-cache` past one
 * that kept it anyway), read once per document per app. Only an ogygia identity has one: the dev
 * server's module URLs never ask.
 */
const current_maps = flights({
	name: 'current build map',
	run: (file: string) =>
		net // ok: a map that could not be read is not kept: the next ask reads again
			.fetch(file, { cache: 'no-cache' })
			.then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : null))
			.catch(() => null),
	// (a map that could not be read is not kept: the next ask reads again)
	keep: (map) => (map ? Infinity : 0)
});

/** A build's island identity (`…/<appDir>/ogygia/og-region.<id>.js`): a name, no file. */
function is_build_identity(entry: string): boolean {
	return absolute(entry).includes('/ogygia/og-region.');
}

/** The current map's file for an identity (`<appDir>/ogygia.json`), or null: not a build's identity. */
function current_map_file(identity: string): string | null {
	const dir = identity.lastIndexOf('/ogygia/og-region.');
	return dir === -1 ? null : `${identity.slice(0, dir)}/ogygia.json`;
}

/** The current build's location for `entry`: null when its map has none, undefined when the map
 *  could not be read (that read is not kept: the next ask reads again). */
async function current_location(entry: string): Promise<string | null | undefined> {
	const identity = absolute(entry);
	const file = current_map_file(identity);
	if (!file) return null;
	const pairs = await current_maps.get(file);
	// (STALE: a recovery dropped it meanwhile, as one it could not use)
	if (!pairs || pairs === STALE) return undefined;
	for (const name in pairs)
		if (absolute(name, file) === identity) {
			const location = absolute(pairs[name], file);
			return is_location_of(identity, location) ? location : null;
		}
	return null;
}

/** The host says this file is not there (it does not say so of a file that failed another way). */
function is_gone(url: string): Promise<boolean> {
	return net.fetch(url, { method: 'HEAD', cache: 'no-store' }).then(
		(res) => res.status === 404 || res.status === 410,
		() => false
	); // ok: no answer is not "gone"; the import's own failure stands
}

/**
 * The current build's file for a build's identity whose file just failed to load. A deploy's rollover
 * is exactly when this is asked, so an answer that cannot be the current one is asked again while it
 * settles: a map that could not be read (a 404, a 5xx), and a map that names the very file that just
 * failed when the host says that file is gone — an edge still answering with the old build's map. A
 * file that failed some other way (the network, a broken module) is not asked about again.
 */
async function recover_location(entry: string, failed: string): Promise<string | null> {
	let current: string | null | undefined;
	// (the asks' waits are this load's own: it ends itself in seconds, and every page that wakes the
	// island shares it, so no page's visit owns it)
	const waits = scope();
	try {
		for (let n = 1; n <= rollover.attempts; n++) {
			if (n > 1) {
				const wait = backoffAfter(rollover, n - 1);
				await waits.task(() => new Promise<void>((resolve) => waits.timeout(resolve, wait)));
			}
			current = await current_location(entry);
			if (current === undefined) continue;
			if (current !== failed || !(await is_gone(failed))) break;
			current_maps.drop(current_map_file(absolute(entry))!);
		}
	} finally {
		waits.close();
	}
	return current ?? null;
}

/**
 * Import an entry: its location when known (else this build's map names it, once read); failing that,
 * or with none anywhere, the CURRENT build's location — so an island on a page that outlived its build
 * still wakes, on the current code. `url`: what the caller resolved for the identity.
 */
export function import_entry<T>(
	entry: string,
	url: string = entry_location(entry) ?? entry
): Promise<T> {
	// (an identity on an origin the page loads no code from asks nothing of it, not even its map)
	try {
		code_url_or_refuse(entry);
	} catch (refused) {
		return Promise.reject(refused);
	}
	if (entry_location(entry)) return load_entry<T>(entry, url);
	const map = read_build_map();
	return (map ?? Promise.resolve()).then(async () => {
		const located = entry_location(entry);
		if (located) return load_entry<T>(entry, located);
		// no location this page knows: the current build's, else the identity as written (dev)
		return load_entry<T>(entry, (await current_location(entry)) || url);
	});
}

function load_entry<T>(entry: string, url: string): Promise<T> {
	let loaded: Promise<T>;
	try {
		// (through its file's loader: a dropped download is asked for again, never the failed URL — #261)
		loaded = import_file<T>(code_url_or_refuse(url, entry));
	} catch (refused) {
		return Promise.reject(refused);
	}
	return loaded.catch(async (error: unknown) => {
		// a build's identity is a name: the current build's map names its file. Any other identity
		// (the dev server's module) is a file itself, fetched fresh past the cache that failed.
		const failed = absolute(url);
		const current = is_build_identity(entry)
			? await recover_location(entry, failed)
			: absolute(entry);
		if (!current || current === failed) throw error;
		const retry = import_file<T>(code_url_or_refuse(current, entry));
		// said out loud: the page's HTML is one build, this island's code the current one (devtools'
		// timeline, and the beacon — the Page tab and the profiler name it)
		const report = (recovered: boolean) => fallback_reporter?.({ entry, src: url, recovered });
		retry.then(
			() => report(true),
			() => report(false)
		);
		return retry;
	});
}
