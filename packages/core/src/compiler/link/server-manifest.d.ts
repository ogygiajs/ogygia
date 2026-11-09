/**
 * `virtual:ogygia/server-manifest` emitter — the SERVER islands' data the `ogygiaHandle()` handle
 * reads (id → CSS-key url, so a server-picked (held) hole can ship its scoped CSS with its response;
 * names; render identities) and `load_islands()`, the one dynamic import of
 * `virtual:ogygia/server-islands`, which holds each island's loader. Populated in BOTH dev and build
 * (unlike the client manifest, which dev fills from URLs); the client build gets empty maps. A
 * whole-program emitter: it reads the Program's descriptor registry.
 *
 * WHY the loaders sit one dynamic import away: Kit links, eagerly, the CSS of every module a page's
 * SERVER graph reaches within one dynamic import (find_deps, `dynamic_import_depth <= 1`). The
 * bundler co-locates this module with whatever shares it (the handle, `region()`), and a page's
 * component imports that chunk statically — so loaders living here put every island of the app one
 * dynamic import from every page, and a Kit-hydrated page linked them all. Behind `load_islands()`
 * they are two away, whatever the chunking (rolldown 1.2.16 regrouped it and exposed exactly this).
 */
import type { Program } from '../program.ts';
/** The SERVER-island ids the manifest carries right now (deferred / server-picked regions). */
export declare function server_island_ids(program: Program): string[];
export declare function server_manifest_module(ssr: boolean, program: Program, is_dev: boolean, devUrlFor: (virtualPath: string) => string, publicUrlFor: (iid: string) => string): string;
/** `virtual:ogygia/server-islands`: each SERVER island's loader, `id → () => import(entry)` (empty on
 *  the client). Imported only by the manifest's `load_islands()` — never statically. */
export declare function server_islands_module(ssr: boolean, program: Program): string;
/** The token the build replaces with its answer (driver `patch_page_data_reads`), inside a string
 *  literal the bundler cannot fold: a plain `null` placeholder was inlined into every reader as the
 *  constant it was (every hole then looked its page up). Unpatched it parses to nothing → `null`. */
export declare const PAGE_DATA_READS_TOKEN = "__OGYGIA_PAGE_DATA_READS__";
export declare const PAGE_DATA_READS_PLACEHOLDER: `(() => { try { return JSON.parse("${typeof PAGE_DATA_READS_TOKEN}"); } catch { return null; } })()`;
