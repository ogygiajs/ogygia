/**
 * The per-region virtual id naming, the `\0`-prefix resolver, and the few virtual ids code outside
 * the table names directly (an `emitFile` entry, a generated import, the docs REPL's reads). Every
 * virtual module is declared in the table (./virtual/core.ts); test/virtual-table.test.ts proves
 * the table answers each id here.
 */
import { specifier } from './virtual/table.ts';

/** Generated sticky entry — static-imports only the features selected from build marks. */
export const V_RUNTIME_ENTRY: string = specifier('boot', 'runtime-entry');
export const V_FN_MANIFEST: string = specifier('boot', 'fn-manifest');
export const V_SERVER_MANIFEST: string = specifier('server', 'server-manifest');
/** The server regions' loaders (`id → () => import(entry)`), reached only through the manifest's
 *  `load_server_regions()` — see link/server-manifest.ts for why they live one dynamic import away. */
export const V_SERVER_REGIONS: string = specifier('server', 'server-regions');
export const V_TRANSPORT: string = specifier('region', 'transport');
export const V_TRANSPORTABLES: string = specifier('region', 'transportables');
/** the string the profiler maps module exports until the build fills it (build-time only: never in
 *  runtime code, so the one literal in the output is the one to replace) */
export const PROFILER_MAPS_PLACEHOLDER = '__ogygia_profiler_maps_placeholder__';
/** the filled maps payload's mark: gzipped JSON, base64 (vite/profiler-maps.ts writes it, the
 *  profiler's embedded-maps reads it) */
export const PROFILER_MAPS_GZ_PREFIX = 'gz:';

/** The region realm's per-file families (declared in ./virtual/core.ts), by their id under the
 *  realm: a prefix ends in `/`, and the rest of the id names the file. */
export const REGION_FAMILY = {
	entry: 'entry/',
	binding: 'binding/',
	lazy: 'lazy/',
	wrapper: 'wrapper/',
	fouc_css: 'fouc-css/',
	fouc_scoped: 'fouc-scoped/',
	registry_stub: 'registry-stub/',
	client_binding_stub: 'client-binding-stub'
} as const;

/** A region family's specifier (a prefix, for the per-file ones). */
export const region_family = (k: keyof typeof REGION_FAMILY): string =>
	specifier('region', REGION_FAMILY[k]);

/** Resolve a virtual id to its `\0`-prefixed resolved form (Vite/rollup convention). */
export const RESOLVED = (id: string): string => '\0' + id;

/** Virtual region ENTRY module id — JS re-export of the real component (not a thin .svelte). */
export const islandVirtualId = (iid: string): string => `${region_family('entry')}${iid}.js`;

/**
 * Region-binding module id. A `with { region: 'raw' }` import is rewritten to import this JS
 * module, whose source is leg-split by the plugin `load` hook: the SSR leg carries the server
 * signer (so `region()` can mint a capability), the client leg is metadata-only (no server
 * code crosses into the browser bundle).
 */
export const regionBindingVirtualId = (iid: string): string =>
	`${region_family('binding')}${iid}.js`;

/**
 * The wake region wrapper's CLIENT-leg component source — the leg-split twin of the wrapper: the SSR
 * wrapper imports the region entry (it must render), the client wrapper imports THIS, a module that
 * imports the entry only when the document rendered the region (emit.ts `lazy_entry_source`). It is
 * how a csr=true host's page graph stops at the wrapper, the same rule the csr=false registry stub
 * applies one level up: what a page ships is decided by what it RENDERED, never by its import graph.
 */
export const lazyEntryVirtualId = (iid: string): string => `${region_family('lazy')}${iid}.js`;

/** The wake region wrapper's component id. */
export const wrapperVirtualId = (iid: string): string => `${region_family('wrapper')}${iid}.svelte`;
