/**
 * The per-island virtual id naming, the `\0`-prefix resolver, and the few virtual ids code outside
 * the table names directly (an `emitFile` entry, a generated import, the docs REPL's reads). Every
 * virtual module is declared in the table (./virtual/core.ts); these are its aliases, by name.
 */

/** Generated sticky entry — static-imports only the features selected from build marks. */
export const V_RUNTIME_ENTRY = 'virtual:ogygia/runtime-entry';
export const V_FN_MANIFEST = 'virtual:ogygia/fn-manifest';
export const V_SERVER_MANIFEST = 'virtual:ogygia/server-manifest';
/** The server islands' loaders (`id → () => import(entry)`), reached only through the manifest's
 *  `load_islands()` — see link/server-manifest.ts for why they live one dynamic import away. */
export const V_SERVER_ISLANDS = 'virtual:ogygia/server-islands';
export const V_TRANSPORT = 'virtual:ogygia/transport';
export const V_TRANSPORTABLES = 'virtual:ogygia/transportables';
/** the string the profiler maps module exports until the build fills it (build-time only: never in
 *  runtime code, so the one literal in the output is the one to replace) */
export const PROFILER_MAPS_PLACEHOLDER = '__ogygia_profiler_maps_placeholder__';
/** the filled maps payload's mark: gzipped JSON, base64 (vite/profiler-maps.ts writes it, the
 *  profiler's embedded-maps reads it) */
export const PROFILER_MAPS_GZ_PREFIX = 'gz:';

/** Resolve a virtual id to its `\0`-prefixed resolved form (Vite/rollup convention). */
export const RESOLVED = (id: string): string => '\0' + id;

/** Virtual island ENTRY module id — JS re-export of the real component (not a thin .svelte). */
export const islandVirtualId = (iid: string) => `virtual:ogygia/island/${iid}.js`;

/**
 * Region-binding module id. A `with { region: 'raw' }` import is rewritten to import this JS
 * module, whose source is leg-split by the plugin `load` hook: the SSR leg carries the server
 * signer (so `region()` can mint a capability), the client leg is metadata-only (no server
 * code crosses into the browser bundle).
 */
export const regionBindingVirtualId = (iid: string) => `virtual:ogygia/region/${iid}.js`;

/**
 * The wake island wrapper's CLIENT-leg component source — the leg-split twin of the wrapper: the SSR
 * wrapper imports the island entry (it must render), the client wrapper imports THIS, a module that
 * imports the entry only when the document rendered the island (emit.ts `lazy_entry_source`). It is
 * how a csr=true host's page graph stops at the wrapper, the same rule the csr=false registry stub
 * applies one level up: what a page ships is decided by what it RENDERED, never by its import graph.
 */
export const lazyEntryVirtualId = (iid: string) => `virtual:ogygia/lazy/${iid}.js`;
