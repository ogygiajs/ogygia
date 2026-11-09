import type { RuntimeMarks } from './link/runtime-entry.ts';
/** Strip a `?query` off a module id (host vs component vs Vite watch paths). */
export declare const strip_id: (id: string) => string;
/** Canonical absolute host key (query-stripped, resolved) — the registry's cross-host dedupe key. */
export declare const host_key: (hostPath: string) => string;
/** One row in the virtual-module registry — an island's entry / wrapper / region-binding artifact.
 *  Loose by design: the three roles carry different legs (source vs ssrSource/clientSource). */
export interface RegistryEntry {
    source?: string;
    ssrSource?: string;
    clientSource?: string;
    hostPath?: string | null;
    id: string;
    server?: boolean;
    lakes?: string[];
    componentPath?: string | null;
    role?: 'entry' | 'wrapper' | 'region' | 'lazy';
    portable?: boolean;
    /** a server entry's render identity (identity.ts `renderId`): what its endpoint renders */
    renderId?: string;
}
/** What a host's last transform indexed: the region ids + virtual paths it minted. */
interface HostIndexEntry {
    ids: Set<string>;
    vpaths: Set<string>;
}
/** One island a file's Lower phase minted — the `register`-relevant fields of a lowered descriptor.
 *  Loose (most fields optional) because the three legs — entry / wrapper / region binding — differ. */
export interface IslandDescriptor {
    id: string;
    kind?: 'hydrate' | 'defer' | 'lake';
    server?: boolean;
    fetchWhen?: string;
    strategy?: string;
    wakeAfter?: string;
    held?: boolean;
    lakes?: string[];
    keep?: string;
    portable?: boolean;
    wrapperPath?: string;
    wrapperSource?: string;
    /** the wrapper's client leg (lazy component; see emit.ts `island_wrapper_client_source`) */
    wrapperClientSource?: string;
    /** the lazy component module the client wrapper imports (`lazyEntryVirtualId`) */
    lazyPath?: string;
    lazySource?: string;
    bindingPath?: string;
    bindingSsrSource?: string;
    bindingClientSource?: string;
    hostPath?: string | null;
    componentPath?: string | null;
    virtualPath?: string;
    source?: string;
    /** the region identity (identity.ts `regionIdentity`) the id was hashed from */
    identity?: string;
}
/** The relevant shape of a file's transform result the linker registers. */
export interface RegisterResult {
    islands?: IslandDescriptor[];
    /** THE one wire question a compilation answers: can this file cross live content into an island?
     *  The transform owns all the evidence — static placement with children, a portable `{#snippet}`,
     *  a wake binding with no static placement (registry/each/`svelte:component`/prop hand-off, where
     *  call sites are compile-invisible), a `.ts`-minted wake region. One flag here, one rule below;
     *  the server encoder is not gated, so a missed case is a production app whose islands ALL fail
     *  with "Unknown type OgygiaRef" (the factory-registry regression). */
    hasWireCrossing?: boolean;
}
export declare class Program {
    /** keyed by virtual path → the island's registry row (entry / wrapper / region binding) */
    readonly registry: Map<string, RegistryEntry>;
    /** Absolute module ids in an island's CLIENT dependency graph. `$app/*` resolves to shims
     *  for these importers (virtual island module AND its transitive component imports). */
    readonly island_graph: Set<string>;
    /** iid -> entry virtual path (hydrate / defer / swr-lake) */
    readonly by_id: Map<string, string>;
    /** every region id -> kind (server manifest / emit) */
    readonly region_kinds: Map<string, 'hydrate' | 'defer' | 'lake'>;
    /** host abs path → region ids + virtual paths discovered on last transform of that host */
    readonly host_index: Map<string, HostIndexEntry>;
    /** region id → hosts still claiming it (cross-host dedupe: don't drop shared wrappers) */
    readonly id_hosts: Map<string, Set<string>>;
    /** Client-leg: hydrate island ids whose deterministic chunk has been emitFile'd (dedup across the
     *  buildStart prescan emit AND the transform-time emit that catches islands prescan can't see —
     *  those declared inside LIBRARY components, where the host lives outside the app's `src`). */
    readonly emitted_island_chunks: Set<string>;
    /** BUILD, server leg: every module id Vite actually transformed (`host_key`-normalised) — the
     *  server bundle's real graph. Handed to the client leg, which emits island chunks only for
     *  islands whose HOST is in it: the prescan registers every marked import under `src/`, but a
     *  host nothing imports (a second route tree's pages, a retired component) must not cost a
     *  chunk — or drag its imports into a client build whose server pass never saw them (a
     *  `.remote.ts` there fails Kit's "expected to find metadata" check). */
    readonly ssr_transformed: Set<string>;
    /** Absolute paths of app modules that define a transportable class (built during prescan). */
    readonly transportable_modules: Set<string>;
    /** PAGE MODULES (`b.pageModules()`: importers of a page specifier such as `'@ogygia/router'`, plus
     *  files named directly — server-router definition sites) + every walked
     *  module's import specifiers — the build data `virtual:ogygia/router-css` computes its
     *  component closure from (see link/router-css.ts). Filled during the prescan walk. */
    readonly router_modules: Set<string>;
    readonly module_specs: Map<string, string[]>;
    /** flag()/experiment() call sites the prescan OBSERVED (modules importing 'ogygia' only) —
     *  written to node_modules/.ogygia/flags-manifest.json at build for CI flag-debt diffs. */
    readonly flag_sites: import('./flags.ts').FlagSite[];
    /** SEED SHAPING: per module (query-less id, forward slashes), the top-level `page.data` keys its
     *  code reads — `'all'` when a read could not be pinned to a literal key. Recorded by the driver's
     *  transform for every module that imports Kit's page store (link/page-keys.ts); the client
     *  `writeBundle` unions them over each island's chunk closure (link/island-deps.ts), and the
     *  handle ships only those keys of `page.data`. */
    readonly page_keys: Map<string, import('./link/page-keys.ts').PageKeys>;
    /** Per module that answered `'all'`: why, and on which line — the build report names it, so a
     *  developer sees the one read that makes a page ship its whole `page.data`. */
    readonly page_key_reasons: Map<string, import('./link/page-keys.ts').AllReason>;
    /** Per module: the `helper(page)` calls into IMPORTED helpers the build follows at `writeBundle`
     *  (resolve the specifier, summarize the export, fold the answer into `page_keys`). */
    readonly page_pending: Map<string, import('./link/page-keys.ts').PendingCall[]>;
    /** App crosses a held region / transportable value through Kit's `transport` hook — a `.remote.*`
     *  file, or a `region`/`site`/content import (loads & remotes that carry regions or wired values).
     *  Set during the prescan walk; with `runtime_marks.wire` it decides whether `ogygia.transport`
     *  (the generated `virtual:ogygia/kit-transport`) carries the codec cluster or is an empty map. */
    crosses_wire: boolean;
    /** Island code can reach Kit's page world (`$app/state` and kin, or something the island-closure
     *  walk could not follow — driver.ts `mark_island_closure`). Folded into `runtime_marks.page` at
     *  the end of the prescan, with the other ways islands the walk never saw reach the runtime. */
    island_reads_page: boolean;
    /** Build-time capability marks for the sticky runtime entry. Incomplete → kitchen-sink. */
    readonly runtime_marks: RuntimeMarks;
    /** The resolved feature set folded into the runtime chunk name (busts the immutable URL when the
     *  app's feature set changes, not only when ogygia's source does). Filled by the driver's prescan;
     *  empty until then (dev serves the package entry). Both build legs prescan the same source → same
     *  hash → the server↔client filename handoff holds. */
    runtime_feature_hash: string;
    constructor(init: {
        forms: boolean;
        router: boolean;
    });
    note_runtime_mark(patch: Partial<RuntimeMarks>): void;
    /** Drop this host's claims; shared region ids (cross-host dedupe) stay until unused. */
    unregister_host(hostPath: string): void;
    /** Replace this host's claims; shared ids keep one registry entry (path+strategy dedupe). */
    register(result: RegisterResult, hostId: string): void;
}
export {};
