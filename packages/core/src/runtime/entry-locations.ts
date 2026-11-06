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

/** absolute identity → absolute location */
const locations = new Map<string, string>();

/** A load that fell back to its identity: who hears about it (the runtime registers the devtools
 *  and beacon reporter at boot). This module imports nothing: app code (a portable snippet) uses it
 *  too, and must not pull the runtime's reporting into the app's chunks. */
export type EntryFallbackReport = { entry: string; src: string; recovered: boolean };
let fallback_reporter: ((report: EntryFallbackReport) => void) | null = null;
export function on_entry_fallback(reporter: (report: EntryFallbackReport) => void): void {
	fallback_reporter = reporter;
}

/** Resolved URLs by base + url: every wake, warm and graph read asks again for the same few
 *  entries, and each ask was a `new URL()` parse (bounded: cleared past a few thousand). */
const resolved_urls = new Map<string, string>();

function absolute(url: string, base?: string): string {
	const b = base ?? location.href;
	const key = b + '\n' + url;
	const hit = resolved_urls.get(key);
	if (hit !== undefined) return hit;
	let out: string;
	try {
		out = new URL(url, b).href;
	} catch {
		out = url;
	}
	if (resolved_urls.size > 4000) resolved_urls.clear();
	resolved_urls.set(key, out);
	return out;
}

/** Remember where an entry is served from. `base`: the document the pair was read from. */
export function note_entry_location(
	entry: string | null | undefined,
	src: string | null | undefined,
	base?: string
): void {
	if (!entry || !src || src === entry) return;
	locations.set(absolute(entry, base), absolute(src, base));
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
const BUILD_MAP_ATTR = 'data-og-locations';
let build_map: Promise<void> | null = null;

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

function read_build_map(): Promise<void> | null {
	if (build_map) return build_map;
	if (typeof document === 'undefined') return null;
	const href = document.querySelector(`script[${BUILD_MAP_ATTR}]`)?.getAttribute(BUILD_MAP_ATTR);
	if (!href) return null;
	const url = absolute(href);
	const read: Promise<void> = fetch(url)
		.then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : null))
		.catch(() => null)
		.then((map) => {
			if (!map) {
				if (build_map === read) build_map = null;
				return;
			}
			for (const stable in map) {
				const identity = absolute(stable, url);
				if (!locations.has(identity)) locations.set(identity, absolute(map[stable], url));
			}
		});
	return (build_map = read);
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
			continue;
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

/** A build's island identity (`…/<appDir>/ogygia/og-region.<id>.js`): a name, no file. */
function is_build_identity(entry: string): boolean {
	return absolute(entry).includes('/ogygia/og-region.');
}

/** The current build's map and the rollover-aware retry (./entry-recovery.ts): loaded on the first
 *  load that needs them, so a page whose files all load never downloads them. */
type Recovery = typeof import('./entry-recovery.ts');
let recovery: Promise<Recovery> | null = null;
const recovery_of = (): Promise<Recovery> => (recovery ??= import('./entry-recovery.ts'));

/**
 * Import an entry: its location when known (else this build's map names it, once read); failing that,
 * or with none anywhere, the CURRENT build's location — so an island on a page that outlived its build
 * still wakes, on the current code. `url`: what the caller resolved for the identity.
 */
export function import_entry<T>(
	entry: string,
	url: string = entry_location(entry) ?? entry
): Promise<T> {
	if (entry_location(entry)) return load_entry<T>(entry, url);
	const map = read_build_map();
	return (map ?? Promise.resolve()).then(async () => {
		const located = entry_location(entry);
		if (located) return load_entry<T>(entry, located);
		// no location this page knows: the current build's, else the identity as written (dev)
		const current = is_build_identity(entry)
			? await (await recovery_of()).current_location(entry)
			: null;
		return load_entry<T>(entry, current || url);
	});
}

function load_entry<T>(entry: string, url: string): Promise<T> {
	const loaded = import(/* @vite-ignore */ url) as Promise<T>;
	return loaded.catch(async (error: unknown) => {
		// a build's identity is a name: the current build's map names its file. Any other identity
		// (the dev server's module) is a file itself, fetched fresh past the cache that failed.
		const failed = absolute(url);
		const current = is_build_identity(entry)
			? await (await recovery_of()).recover_location(entry, failed)
			: absolute(entry);
		if (!current || current === failed) throw error;
		const retry = import(/* @vite-ignore */ current) as Promise<T>;
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
