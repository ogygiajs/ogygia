import path from 'node:path';
import { renderId } from './region/identity.ts';
import { resolveFeatures, type FeatureId, type RuntimeMarks } from './link/runtime-entry.ts';
import { warn } from './messages.ts';
import { same_module_path } from './dev/hmr.ts';
import { scan_facts, type ScanFacts } from './scan-facts.ts';

/** Strip a `?query` off a module id (host vs component vs Vite watch paths). */
export const strip_id = (id: string): string => (id ? id.split('?')[0] : id);

/** Canonical absolute host key (query-stripped, resolved) — the registry's cross-host dedupe key. */
export const host_key = (hostPath: string): string => path.resolve(strip_id(hostPath));

/** One row in the virtual-module registry — an island's entry / wrapper / region-binding artifact.
 *  Loose by design: the three roles carry different legs (source vs ssrSource/clientSource). */
export interface RegistryEntry {
	source?: string;
	ssrSource?: string;
	/** A leg-split source: a wake island's wrapper reaches its component through the lazy module on
	 *  the client leg (served by leg at load(), like a region binding). */
	clientSource?: string;
	hostPath?: string | null;
	id: string;
	server?: boolean;
	lakes?: string[];
	componentPath?: string | null;
	role?: 'entry' | 'wrapper' | 'region' | 'lazy';
	/** A portable-snippet synth entry: AUTHORED markup (a slice of user source) the transform hook
	 *  re-processes (nested island marks, nested snippets), unlike glue. */
	portable?: boolean;
	/** a server entry's render identity (identity.ts `renderId`): what its endpoint renders */
	renderId?: string;
}

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

export class Program {
	/** keyed by virtual path → the island's registry row (entry / wrapper / region binding) */
	readonly registry: Map<string, RegistryEntry> = new Map();
	/** Absolute module ids in an island's CLIENT dependency graph. `$app/*` resolves to shims
	 *  for these importers (virtual island module AND its transitive component imports). */
	readonly island_graph: Set<string> = new Set();
	/** iid -> entry virtual path (hydrate / defer / swr-lake) */
	readonly by_id: Map<string, string> = new Map();
	/** every region id -> kind (server manifest / emit) */
	readonly region_kinds: Map<string, 'hydrate' | 'defer' | 'lake'> = new Map();
	/** host abs path → region ids + virtual paths discovered on last transform of that host */
	readonly host_index: Map<string, HostIndexEntry> = new Map();
	/** region id → hosts still claiming it (cross-host dedupe: don't drop shared wrappers) */
	readonly id_hosts: Map<string, Set<string>> = new Map();
	/** BUILD, server leg: every module id Vite actually transformed (`host_key`-normalised) — the
	 *  server bundle's real graph. Handed to the client leg, which emits island chunks only for
	 *  islands whose HOST is in it: the prescan registers every marked import under `src/`, but a
	 *  host nothing imports (a second route tree's pages, a retired component) must not cost a
	 *  chunk — or drag its imports into a client build whose server pass never saw them (a
	 *  `.remote.ts` there fails Kit's "expected to find metadata" check). */
	readonly ssr_transformed: Set<string> = new Set();
	/** Every scanned file's facts, and the app-wide answers folded from them (./scan-facts.ts). */
	readonly scan: ScanFacts = scan_facts();
	/** Absolute paths of app modules that define a transportable class, in scan order. */
	get transportable_modules(): ReadonlySet<string> {
		return this.scan.db.get(this.scan.transportable_modules, 'all');
	}

	/** PAGE MODULES (`b.pageModules()`: importers of a page specifier such as `'@ogygia/router'`, plus
	 *  files named directly — server-router definition sites) + every walked
	 *  module's import specifiers — the build data `ogygia:server/router-css` computes its
	 *  component closure from (see link/router-css.ts). */
	get router_modules(): ReadonlySet<string> {
		return this.scan.db.get(this.scan.router_modules, 'all');
	}
	get module_specs(): ReadonlyMap<string, readonly string[]> {
		return this.scan.db.get(this.scan.module_specs, 'all');
	}
	/** SEED SHAPING: per module (query-less id, forward slashes), the top-level `page.data` keys its
	 *  code reads — `'all'` when a read could not be pinned to a literal key. Recorded by the driver's
	 *  transform for every module that imports Kit's page store (link/page-keys.ts); the client
	 *  `writeBundle` unions them over each island's chunk closure (link/island-deps.ts), and the
	 *  handle ships only those keys of `page.data`. */
	readonly page_keys: Map<string, import('./link/page-keys.ts').PageKeys> = new Map();
	/** Per module that answered `'all'`: why, and on which line — the build report names it, so a
	 *  developer sees the one read that makes a page ship its whole `page.data`. */
	readonly page_key_reasons: Map<string, import('./link/page-keys.ts').AllReason> = new Map();
	/** Per module: the `helper(page)` calls into IMPORTED helpers the build follows at `writeBundle`
	 *  (resolve the specifier, summarize the export, fold the answer into `page_keys`). */
	readonly page_pending: Map<string, import('./link/page-keys.ts').PendingCall[]> = new Map();

	/** App crosses a held region / transportable value through Kit's `transport` hook — a `.remote.*`
	 *  file, or a `region`/`site`/content import (loads & remotes that carry regions or wired values).
	 *  With `runtime_marks.wire` it decides whether `ogygia.transport` (the generated
	 *  `ogygia:region/kit-transport`) carries the codec cluster or is an empty map. */
	get crosses_wire(): boolean {
		return this.wire_crossers.size > 0;
	}
	/** The files that make {@link crosses_wire} true. */
	get wire_crossers(): ReadonlySet<string> {
		return this.scan.db.get(this.scan.wire_crossers, 'all');
	}

	/** Island code can reach Kit's page world (`$app/state` and kin, or something the island-closure
	 *  walk could not follow — driver.ts `mark_island_closure`). Folded into `runtime_marks.page` at
	 *  the end of the prescan, with the other ways islands the walk never saw reach the runtime. */
	island_reads_page = false;

	/** Build-time capability marks for the sticky runtime entry. Incomplete → kitchen-sink. */
	readonly runtime_marks: RuntimeMarks;

	/** The features the build's runtime entry was made with (`ship_runtime`), once it loaded: a later
	 *  registration that needs one more is reported (`runtime_marks_late`), once per feature. */
	#runtime_shipped: ReadonlySet<FeatureId> | null = null;
	readonly #late_said = new Set<FeatureId>();

	readonly #init: { forms: boolean; router: boolean };

	/** An empty program with the same options: the next build's (`Compiler.start_leg`). */
	fresh(): Program {
		return new Program(this.#init);
	}

	constructor(init: { forms: boolean; router: boolean }) {
		this.#init = init;
		this.runtime_marks = {
			complete: false,
			forms: init.forms,
			wire: false,
			remoteSeeds: false,
			hydrate: [],
			defer: [],
			persistKeys: [],
			router: init.router,
			live: false,
			lakes: false
		};
	}

	/** The marks the build's runtime entry is made from, now: what it ships is fixed from here on
	 *  (test/runtime-marks-late.test.ts). */
	ship_runtime(): RuntimeMarks {
		this.#runtime_shipped = new Set(resolveFeatures(this.runtime_marks));
		return this.runtime_marks;
	}

	/** A registration of `host` after the runtime entry was made needs a feature it lacks: say so. */
	#check_late(host: string): void {
		const shipped = this.#runtime_shipped;
		if (!shipped) return;
		const late = resolveFeatures(this.runtime_marks).filter(
			(f) => !shipped.has(f) && !this.#late_said.has(f)
		);
		if (!late.length) return;
		for (const f of late) this.#late_said.add(f);
		warn('runtime_marks_late', { file: host, features: late.join(', ') });
	}

	note_runtime_mark(patch: Partial<RuntimeMarks>): void {
		const runtime_marks = this.runtime_marks;
		if (patch.hydrate) {
			runtime_marks.hydrate = [...new Set([...(runtime_marks.hydrate || []), ...patch.hydrate])];
		}
		if (patch.defer) {
			runtime_marks.defer = [...new Set([...(runtime_marks.defer || []), ...patch.defer])];
		}
		if (patch.persistKeys) {
			runtime_marks.persistKeys = [
				...new Set([...(runtime_marks.persistKeys || []), ...patch.persistKeys])
			];
		}
		if (patch.router) runtime_marks.router = true;
		if (patch.live) runtime_marks.live = true;
		if (patch.persist) runtime_marks.persist = true;
		if (patch.morph) runtime_marks.morph = true;
		if (patch.lakes) runtime_marks.lakes = true;
		if (patch.wire) runtime_marks.wire = true;
	}

	/** Drop this host's claims; shared region ids (cross-host dedupe) stay until unused. */
	unregister_host(hostPath: string): void {
		const { registry, island_graph, by_id, region_kinds, host_index, id_hosts } = this;
		const key = host_key(hostPath);
		const prev = host_index.get(key);
		if (prev) {
			for (const id of prev.ids) {
				const claims = this.#rows.get(id);
				claims?.delete(key);
				if (claims?.size === 0) this.#rows.delete(id);
				const holders = id_hosts.get(id);
				if (holders) {
					holders.delete(key);
					if (holders.size === 0) {
						id_hosts.delete(id);
						region_kinds.delete(id);
						by_id.delete(id);
					}
				} else {
					region_kinds.delete(id);
					by_id.delete(id);
				}
			}
			for (const vpath of prev.vpaths) {
				const entry = registry.get(vpath);
				if (entry) {
					const holders = id_hosts.get(entry.id);
					if (!holders || holders.size === 0) {
						registry.delete(vpath);
						island_graph.delete(vpath);
					}
				} else {
					registry.delete(vpath);
					island_graph.delete(vpath);
				}
			}
			for (const id of prev.ids) this.#settle(id);
			host_index.delete(key);
		}
	}

	/** BUILD, server leg: the server regions `ogygia:server/server-regions` was written with, each
	 *  `() => import(<its entry>)`. A region found later gets its loader as its own emitted chunk
	 *  (driver `emit_late_server_regions`, test/server-region-late.test.ts). Null: not written yet. */
	server_regions_written: ReadonlySet<string> | null = null;

	/** Replace this host's claims; shared ids keep one registry entry (path+strategy dedupe). */
	register(result: RegisterResult, hostId: string): void {
		const { island_graph, by_id, region_kinds, host_index, id_hosts } = this;
		this.unregister_host(hostId);
		const key = host_key(hostId);
		if (result.hasWireCrossing) this.note_runtime_mark({ wire: true });
		const idx: HostIndexEntry = { ids: new Set(), vpaths: new Set() };
		for (const isl of result.islands ?? []) {
			const kind = isl.kind ?? (isl.server ? 'defer' : 'hydrate');
			region_kinds.set(isl.id, kind);
			idx.ids.add(isl.id);
			if (kind === 'defer') this.note_runtime_mark({ defer: [isl.fetchWhen || 'load'] });
			if (kind === 'hydrate') this.note_runtime_mark({ hydrate: [isl.strategy || 'load'] });
			if (isl.wakeAfter) this.note_runtime_mark({ hydrate: [isl.wakeAfter] });
			if (kind === 'lake') this.note_runtime_mark({ lakes: true, hydrate: ['none'] });
			if (isl.held) this.note_runtime_mark({ live: true, morph: true });
			if (isl.lakes?.length) this.note_runtime_mark({ lakes: true });
			if (isl.keep) this.note_runtime_mark({ persist: true, persistKeys: [isl.keep] });
			let holders = id_hosts.get(isl.id);
			if (!holders) {
				holders = new Set();
				id_hosts.set(isl.id, holders);
			}
			holders.add(key);
			const rows: Array<[string, RegistryEntry]> = [];

			if (isl.wrapperPath && isl.wrapperSource) {
				rows.push([
					isl.wrapperPath,
					{
						source: isl.wrapperSource,
						clientSource: isl.wrapperClientSource,
						hostPath: isl.hostPath,
						id: isl.id,
						server: false,
						lakes: isl.lakes ?? [],
						componentPath: isl.componentPath ?? null,
						role: 'wrapper'
					}
				]);
				idx.vpaths.add(isl.wrapperPath);
				island_graph.add(isl.wrapperPath);
			}
			if (isl.lazyPath && isl.lazySource) {
				rows.push([
					isl.lazyPath,
					{
						source: isl.lazySource,
						hostPath: isl.hostPath,
						id: isl.id,
						server: false,
						lakes: [],
						componentPath: isl.componentPath ?? null,
						role: 'lazy'
					}
				]);
				idx.vpaths.add(isl.lazyPath);
				island_graph.add(isl.lazyPath);
			}
			if (isl.bindingPath && isl.bindingSsrSource) {
				rows.push([
					isl.bindingPath,
					{
						ssrSource: isl.bindingSsrSource,
						clientSource: isl.bindingClientSource ?? isl.bindingSsrSource,
						hostPath: isl.hostPath,
						id: isl.id,
						server: false,
						lakes: [],
						componentPath: isl.componentPath ?? null,
						role: 'region'
					}
				]);
				idx.vpaths.add(isl.bindingPath);
				island_graph.add(isl.bindingPath);
			}
			if (isl.virtualPath && isl.source) {
				rows.push([
					isl.virtualPath,
					{
						source: isl.source,
						hostPath: isl.hostPath,
						id: isl.id,
						server: !!isl.server,
						lakes: [],
						componentPath: isl.componentPath ?? null,
						role: 'entry',
						portable: isl.portable === true,
						...(isl.server && isl.identity ? { renderId: renderId(isl.identity) } : {})
					}
				]);
				by_id.set(isl.id, isl.virtualPath);
				idx.vpaths.add(isl.virtualPath);
				island_graph.add(isl.virtualPath);
			} else if (isl.virtualPath) {
				by_id.set(isl.id, isl.virtualPath);
			}
			let claims = this.#rows.get(isl.id);
			if (!claims) this.#rows.set(isl.id, (claims = new Map()));
			claims.set(key, rows);
			this.#settle(isl.id);
			if (isl.componentPath) island_graph.add(isl.componentPath);
		}
		host_index.set(key, idx);
		this.#check_late(hostId);
	}

	/** A deleted component: every region of it goes, with every host's claim on it (a claim kept
	 *  would outrank the next host to mark it: test/region-host-order.test.ts). Returns the virtual
	 *  paths that went. */
	drop_component(componentPath: string): Set<string> {
		const gone = new Set<string>();
		const ids = new Set<string>();
		for (const entry of this.registry.values())
			if (same_module_path(entry.componentPath, componentPath)) ids.add(entry.id);
		for (const id of ids) {
			for (const rows of this.#rows.get(id)?.values() ?? [])
				for (const [vpath] of rows) gone.add(vpath);
			for (const [vpath, entry] of this.registry) if (entry.id === id) gone.add(vpath);
			this.#rows.delete(id);
			this.id_hosts.delete(id);
			this.by_id.delete(id);
			this.region_kinds.delete(id);
		}
		for (const vpath of gone) {
			this.registry.delete(vpath);
			this.island_graph.delete(vpath);
		}
		for (const idx of this.host_index.values()) {
			for (const id of ids) idx.ids.delete(id);
			for (const vpath of gone) idx.vpaths.delete(vpath);
		}
		return gone;
	}

	/** Each region id's rows, by the host that claimed them (test/region-host-order.test.ts). */
	readonly #rows = new Map<string, Map<string, Array<[string, RegistryEntry]>>>();

	/** The registry shows a shared region's rows from its FIRST holder in host order, whatever
	 *  order the hosts were transformed (and unregistered) in. */
	#settle(id: string): void {
		const claims = this.#rows.get(id);
		if (!claims || claims.size === 0) return;
		let first: string | null = null;
		for (const k of claims.keys()) if (first === null || k < first) first = k;
		for (const [vpath, entry] of claims.get(first!)!) this.registry.set(vpath, entry);
	}
}
