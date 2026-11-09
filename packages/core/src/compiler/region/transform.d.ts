import type { SourceMap } from 'magic-string';
import type { IslandDescriptor } from '../program.ts';
import { strategyKey, regionIdentity, regionId } from './identity.ts';
import { regionBindingVirtualId } from '../ids.ts';
import type * as NodePath from 'node:path';
/** The resolved context the adapter/driver threads into a host transform. */
interface HostCtx {
    root: string;
    libDir: string;
    readFile: (abs: string) => string | null;
    pathModule: typeof NodePath;
    dev: boolean;
    virtualPathFor: (hostId: string, iid: string) => string;
    /** Absent: the island's wrapper virtual id (`wrapperVirtualId`). */
    wrapperPathFor?: (hostId: string, iid: string) => string;
    devUrlFor: (virtualPath: string) => string;
    /**
     * The REAL source file a module derives from — the resolution base for its relative specifiers.
     * A generated entry (a portable-snippet synth is authored markup re-processed under a
     * `virtual:ogygia/…` id) has no directory of its own: every `./x` / `../x` inside it must resolve
     * against the file the slice was cut from, exactly as the driver's `resolve_id` already rebases
     * that entry's plain imports. Identity for a real file. Optional for legacy callers (= identity).
     */
    originOf?: (id: string) => string;
    /** Install-independent identity (`<pkg-name>/<rel>`) for files under a declared `ogygia.files`
     *  package — `null`/absent falls back to root-relative (see CompileCtx.pkg_identity). */
    pkg_identity?: (abs: string) => string | null;
    /** SvelteKit `appDir` (default `_app`) — where island chunks are emitted + served (base-less; Kit's
     *  `asset()` adds `base`/assets at render). */
    appDir?: string;
    visibleMargin: string | undefined;
    presets: Record<string, unknown>;
    importKeys: Partial<ImportKeys> | undefined;
    /** Absent or empty: no salt. */
    idSalt?: string;
    /** Absent: true (a binding links its real wrapper; `false` links the client stub). */
    linkVirtualIsland?: boolean;
    /** Absent or empty: the built-in `CLIENT_BINDING_STUB`. */
    clientBindingStub?: string;
    routeCsr: boolean | undefined;
    ssr: boolean;
}
/** The resolved context threaded into a `.ts`/`.js` region mint (`transformTsRegions`). */
interface TsRegionCtx {
    root: string;
    libDir: string;
    pathModule: typeof NodePath;
    dev: boolean;
    virtualPathFor: (hostId: string, iid: string) => string;
    devUrlFor: (virtualPath: string) => string;
    /** SvelteKit `appDir` (default `_app`) — where island chunks are emitted + served (base-less; Kit's
     *  `asset()` adds `base`/assets at render). */
    appDir?: string;
    importKeys: Partial<ImportKeys> | undefined;
    /** Absent or empty: no salt. */
    idSalt?: string;
    /** Guarded (typeof) — the ts-region leg falls back to `wrapperVirtualId` when absent. */
    wrapperPathFor?: (hostId: string, iid: string) => string;
    /** Guarded (`!= null`) — only a `visible` strategy reads it. */
    visibleMargin?: string;
    /** Guarded (typeof) — install-independent identity for declared `ogygia.files` package files. */
    pkg_identity?: (abs: string) => string | null;
}
export { foucCssVirtualId } from '../fouc-css.ts';
export declare const ISLAND_DIR = ".ogygia";
/** True for a GENERATED island glue id (virtual island entry / wrapper / region binding, or the legacy
 *  on-disk `.ogygia/` shape) — the ids that are ogygia's own emit, not authored app/component source. */
export declare function is_island_path(id: string): boolean;
/**
 * Default import-attribute keys — the two-dial grammar. Internal role names stay `hydrate`/`defer`
 * (the wire format + runtime keep those anchors); the user-facing ATTRIBUTE names are the values.
 * Override via `ogygia({ importKeys })`.
 * - `render` attribute → the MODE: `static` (inline HTML) | `deferred` (a hole, fetched) | `live`
 *   (a hole that revalidates). Defaults to `static`.
 * - `fetch` attribute → a `deferred` hole's TIMING, when its HTML arrives (default `load`):
 *   `with { render: 'deferred', fetch: 'visible' }`.
 * - `wake` attribute → when an island's JS runs (`none`: a lake). Never a hole's timing.
 */
export declare const DEFAULT_IMPORT_KEYS: {
    readonly wake: 'wake';
    readonly fetch: 'fetch';
    readonly render: 'render';
    readonly preset: 'preset';
    readonly region: 'region';
};
/**
 * Import-attribute key names claimed by the transform
 * (`with { wake | fetch | render | preset | region }`). Override via `ogygia({ importKeys })` when
 * another tool already uses the default names.
 */
export type ImportKeys = {
    /** When an island's JS runs (default attribute `'wake'`); `'none'` makes a lake. For `live` it is
     * the revalidate schedule. */
    wake: string;
    /** A `render: 'deferred'` hole's timing — when its HTML arrives (default attribute `'fetch'`):
     * `'load'` | `'idle'` | `'visible'` | `'interaction'` | a media query. */
    fetch: string;
    /** The delivery MODE (default attribute `'render'`): `static` | `deferred` | `live`. */
    render: string;
    /** Named preset attribute (default `'preset'`). */
    preset: string;
    /** Held-across-a-boundary marker (default attribute `'region'`, only value `'raw'`) — a component
     * a registry hands to `region()` where the transform can't see the call. */
    region: string;
};
export declare function normalize_import_keys(overrides?: Partial<ImportKeys> | null): ImportKeys;
export declare function import_keys_hint(import_keys: ImportKeys): RegExp;
/** Deterministic short id for a region (stable across dev + build).
 * When `salt` is set (production `OGYGIA_SECRET`), ids are not offline-computable (P1-ID).
 * Paths are always posix so SSR/client builds agree across OS path separators. */
export declare function islandId(relHostPath: string, index: string | number, salt?: string): string;
/**
 * The directory, under the app dir, of the STABLE names (an island's identity, the runtime's): not
 * `immutable/`. A host serves `immutable/` for a year by name (every adapter, every CDN rule written
 * for it), and a stable name keeps its name while its content follows each build: a year-old copy
 * would load another build's code. Here a host's ordinary rule revalidates them. The content-hashed
 * files they point at stay in `immutable/`.
 */
export declare const STABLE_NAME_DIR = "ogygia";
/**
 * Deterministic client path of a hydrate island's stable name (mirrors the runtime's). SSR bakes it
 * into `<ogygia-region entry>` as the island's identity — a name, not a file: the content-hashed
 * entry is found through the handoff (the server) and the location maps (the browser,
 * link/location-map.ts), since Kit builds server before client.
 */
export declare function islandChunkFileName(iid: string, appDir?: string): string;
/** App-internal URL for {@link islandChunkFileName}: `/<appDir>/ogygia/…` (leading slash, appDir,
 *  NO base). It is what SSR bakes onto `<ogygia-region entry>`; `Region.svelte` runs it through Kit's
 *  `asset()` at render time, which is the sole authority on `base` / the assets CDN / relative paths —
 *  so a base is never baked here (that would double-apply it). NOT the on-disk output filename. */
export declare function islandPublicUrl(iid: string, appDir?: string): string;
/** Portable wrapper module id — SSR / csr=true host binding (Island/ServerIsland/Lake shell). */
export declare function wrapperVirtualId(iid: string): string;
/**
 * The local bindings a file hands to `import.meta.og.asRegion(X)`. An island's identity is keyed on
 * the import that binds `X` (`'<specifier>#<export>'`), and the prescan derives it from the raw
 * source on disk — so no pass that runs before the transform may rewrite that import (the debarrel
 * pass leaves declarations binding these names alone, as it does marked imports). A textual scan on
 * purpose: it runs before any parse, on every transformed file.
 */
export declare function asRegionLocals(code: string): Set<string>;
/**
 * csr=false CLIENT host binding target. Kit still emits those page nodes; pointing marked
 * imports here (instead of wrappers) keeps N island wrappers/entries out of the page graph so
 * `emitFile` owns hydrate modules and Rolldown does not thin-facade them. Hydration uses
 * `import(entry)` only — this stub is never loaded for island JS.
 *
 * Beside the stub the transform emits `import 'virtual:ogygia/fouc-css/<entry>'` so Kit still
 * links stylesheets (FOUC) via CSS-only side effects. Importing the full `.svelte` JS module
 * dual-owns it with the emitFile island entry and Rolldown thin-facades `og-region.*`.
 * Omitting CSS entirely orphans rules (scoped class hashes, no stylesheet).
 */
export declare const CLIENT_BINDING_STUB = "virtual:ogygia/client-binding-stub";
export { strategyKey, regionIdentity, regionId };
export { regionBindingVirtualId };
/**
 * The `with { region: … }` marker has ONE value — `'raw'` (an adjective: "a raw/held region"). It
 * carries NO schedule: the wake timing is set at the `region()` call (`region(C, props, { wake })`)
 * or, in a block tree, per node. This is the only surviving import-attribute marker for a component
 * a registry hands to `region()` where the transform can't see the call site.
 *
 * @param raw the marker value
 * @param where host label for error messages
 * @param regionKey configured `region` attribute name (for the message)
 */
export declare function normalize_region_value(raw: string, where: string, regionKey?: string): void;
/**
 * Validate a `wake:` schedule value on a held import (a `.ts` registry / remote). Accepts the wake
 * strategies (`load` / `idle` / `visible` / `interaction`) or a media query — the same vocabulary as
 * a placed island's `wake:`. Returns the value unchanged (it becomes the baked `__hydrate`).
 */
export declare function normalize_hydrate_value(raw: string, where: string, wakeKey?: string): string;
export declare function transformHost(source: string, id: string, ctx: HostCtx): {
    code: string;
    map: SourceMap;
    islands: never[];
} | {
    code: string;
    map: SourceMap;
    islands: IslandDescriptor[];
    hasWireCrossing: boolean;
} | null;
export declare function transformTsRegions(source: string, id: string, ctx: TsRegionCtx): {
    code: string;
    map: SourceMap;
    islands: IslandDescriptor[];
    hasWireCrossing: boolean;
} | null;
