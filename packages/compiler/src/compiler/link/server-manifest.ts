/**
 * `ogygia:server/server-manifest` emitter — the SERVER islands' data the `ogygiaHandle()` handle
 * reads (id → CSS-key url, so a server-picked (held) hole can ship its scoped CSS with its response;
 * names; render identities) and `load_islands()`, the one dynamic import of
 * `ogygia:server/server-regions`, which holds each island's loader. Populated in BOTH dev and build
 * (unlike the client manifest, which dev fills from URLs); the client build gets empty maps. A
 * whole-program emitter: it reads the Program's descriptor registry.
 *
 * A BUILD loads this module early (the handle imports it), before the bundler has reached every
 * host: a server region whose host the start-up scan never saw registers later (#1420). So a build
 * writes each map as a token, filled in from the final registry when its chunk is finished
 * (link/relocations.ts), and a region found after `server-regions` was written gets its loader as
 * its own emitted chunk, named in that module by another token. Dev writes the values: a change
 * there loads the module again.
 *
 * WHY the loaders sit one dynamic import away: Kit links, eagerly, the CSS of every module a page's
 * SERVER graph reaches within one dynamic import (find_deps, `dynamic_import_depth <= 1`). The
 * bundler co-locates this module with whatever shares it (the handle, `region()`), and a page's
 * component imports that chunk statically — so loaders living here put every island of the app one
 * dynamic import from every page, and a Kit-hydrated page linked them all. Behind `load_islands()`
 * they are two away, whatever the chunking (rolldown 1.2.16 regrouped it and exposed exactly this).
 */
import type { Program, RegistryEntry } from '../program.ts';
import { V_SERVER_REGIONS } from '../ids.ts';
import { dedent } from '@ogygia/core/contract';

/** The SERVER regions (deferred / server-picked), sorted by id: what the server leg writes is a
 *  function of the set, never of the order hosts registered in (test/server-manifest-late-order.test.ts). */
export function server_regions(program: Program): Array<[string, string, RegistryEntry]> {
	const out: Array<[string, string, RegistryEntry]> = [];
	for (const [iid, virtualPath] of program.by_id) {
		const reg = program.registry.get(virtualPath);
		if (reg?.server) out.push([iid, virtualPath, reg]);
	}
	return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The SERVER-island ids the manifest carries right now (deferred / server-picked regions). */
export function server_island_ids(program: Program): string[] {
	return server_regions(program).map(([iid]) => iid);
}

/** The manifest's four maps, by export name. */
export type ServerManifestMaps = Record<
	'region_url' | 'region_name' | 'region_render' | 'render_region',
	Record<string, string>
>;

/** The manifest's maps from the program's registry; `url_for` names a region's CSS-key URL. */
export function server_manifest_maps(
	program: Program,
	url_for: (iid: string, virtual_path: string) => string
): ServerManifestMaps {
	const maps: ServerManifestMaps = {
		region_url: {},
		region_name: {},
		region_render: {},
		render_region: {}
	};
	/** render id → the server entry that renders it (the smallest id: one answer per build) */
	const by_render = new Map<string, string>();
	for (const [iid, virtualPath, reg] of server_regions(program)) {
		// id → its render identity, signed into every capability minted for it; render identity → an
		// entry rendering it, for a capability minted by another build (compiler/region/identity.ts)
		if (reg.renderId) {
			maps.region_render[iid] = reg.renderId;
			const seen = by_render.get(reg.renderId);
			if (seen === undefined || iid < seen) by_render.set(reg.renderId, iid);
		}
		// id → its component's name (`SlowHole` from `…/SlowHole.svelte`): the profiler names a hole
		// request by it (neither URL carries the name: both are keyed by the id)
		const file = reg.componentPath ?? '';
		const base = file.slice(file.lastIndexOf('/') + 1);
		if (base.endsWith('.svelte')) maps.region_name[iid] = base.slice(0, -7);
		// id → the URL `islandCss()` is keyed by, so the handle can ship a server-picked hole's
		// CSS with its response (a page that never imported the component still styles it). In a
		// build that's the hashed client chunk (→ handoff CSS assets); in dev it's the entry's
		// dev module URL (→ `islandCss` returns it, the client imports it for CSS). Same channel.
		maps.region_url[iid] = url_for(iid, virtualPath);
	}
	for (const [r, iid] of by_render) maps.render_region[r] = iid;
	return maps;
}

/** The token a build writes for each map, inside a string literal the bundler cannot fold. */
export const SERVER_MAP_TOKENS: Record<keyof ServerManifestMaps, string> = {
	region_url: '__OGYGIA_SERVER_REGION_URL__',
	region_name: '__OGYGIA_SERVER_REGION_NAME__',
	region_render: '__OGYGIA_SERVER_REGION_RENDER__',
	render_region: '__OGYGIA_SERVER_RENDER_REGION__'
};

export function server_manifest_module(
	ssr: boolean,
	program: Program,
	is_dev: boolean,
	devUrlFor: (virtualPath: string) => string
): string {
	if (!ssr) {
		return dedent`
			export const load_server_regions = () => Promise.resolve({ regions: {} });
			export const region_url = {};
			export const region_name = {};
			export const region_render = {};
			export const render_region = {};
			export const region_reads_page_data = null;
		`;
	}
	const maps = is_dev ? server_manifest_maps(program, (_iid, vp) => devUrlFor(vp)) : null;
	const value = (name: keyof ServerManifestMaps): string =>
		maps ? JSON.stringify(maps[name]) : `JSON.parse("${SERVER_MAP_TOKENS[name]}")`;
	return dedent`
		export const load_server_regions = () => import(${JSON.stringify(V_SERVER_REGIONS)});

		export const region_url = ${value('region_url')};

		export const region_name = ${value('region_name')};

		export const region_render = ${value('region_render')};

		export const render_region = ${value('render_region')};

		// id → does the hole's SERVER tree read \`page.data\` (the page lookup a hole needs: server/
		// render-page.ts). Known only once every module is transformed: a build patches the
		// placeholder in renderChunk (link/relocations.ts); dev leaves \`null\` (unknown → look up).
		export const region_reads_page_data = ${is_dev ? 'null' : PAGE_DATA_READS_PLACEHOLDER};
	`;
}

/** In a build's `server-regions`, the loaders of the regions found after it was written: an
 *  identifier no module defines, so the bundler keeps it as written (link/relocations.ts). */
export const LATE_SERVER_REGIONS_TOKEN = '__OGYGIA_LATE_SERVER_REGIONS__';

/** `ogygia:server/server-regions`: each SERVER island's loader, `id → () => import(entry)` (empty on
 *  the client). Imported only by the manifest's `load_islands()` — never statically. `late`: a
 *  build's, which names the loaders of regions found after it (`Program.server_regions_written`). */
export function server_regions_module(ssr: boolean, program: Program, late: boolean): string {
	const entries: string[] = [];
	if (ssr)
		for (const [iid, virtualPath] of server_regions(program))
			entries.push(`${JSON.stringify(iid)}: () => import(${JSON.stringify(virtualPath)})`);
	if (ssr && late) entries.push(`...${LATE_SERVER_REGIONS_TOKEN}`);
	return dedent`
		export const regions = {
			${entries.join(',\n\t')}
		};
	`;
}

/** The token the build replaces with its answer (link/relocations.ts), inside a string literal the
 *  bundler cannot fold: a plain `null` placeholder was inlined into every reader as the constant it
 *  was (every hole then looked its page up). Unpatched it parses to nothing → `null`. */
export const PAGE_DATA_READS_TOKEN = '__OGYGIA_PAGE_DATA_READS__';
export const PAGE_DATA_READS_PLACEHOLDER: `(() => { try { return JSON.parse("${typeof PAGE_DATA_READS_TOKEN}"); } catch { return null; } })()` = `(() => { try { return JSON.parse("${PAGE_DATA_READS_TOKEN}"); } catch { return null; } })()`;
