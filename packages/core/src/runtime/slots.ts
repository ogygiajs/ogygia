/**
 * The one seam between the always-on {@link ./core.js core} and the optional feature modules.
 *
 * `core` (and `router`) never statically import a feature impl — that would defeat the per-app
 * tree-shaking the generated runtime entry relies on. Instead each feature's `install()` fills its
 * typed slot here, and core reads the slot. Slots that core calls unconditionally (`lakes`,
 * `forms`) carry a no-op default so the feature can be absent; the rest are `null` until
 * a feature provides them and are read with optional chaining.
 *
 * This is the single wiring mechanism — there is no service locator and no per-feature setter.
 */
import type { Scope, Stale } from '@ogygia/machine';
import type { Frame } from '../frame.ts';
import { is_frozen } from './region-attrs.ts';

// ── lakes ────────────────────────────────────────────────────────────────
/** Frozen SSR DOM detached before hydrate. */
export type LiftedLake = {
	id: string;
	frag: DocumentFragment;
	endpoint: string;
	when: string;
	maxAgeMs: number;
};

/** Region schedule hooks lakes need without importing the custom element. */
export type LakeArm = {
	idle: (fire: () => void) => void;
	visible: (fire: () => void, margin?: string) => void;
	media: (when: string, fire: () => void) => void;
	fetch_revalidate: () => void;
	wake_children: () => void;
};

export type LakeOps = {
	on_frozen_connect(el: HTMLElement, arm: LakeArm): boolean;
	wait_for_boundary(el: HTMLElement, boundary: Element | null): boolean;
	lift(parent: Element): LiftedLake[];
	restore(parent: Element, lifted: LiftedLake[]): void;
	settle_in(root: ParentNode): void;
	mark_frozen_settled(region: HTMLElement): void;
	/** After an answer swapped into `region`: a lake that settled wakes the regions waiting on it. */
	after_html_swap(
		region: HTMLElement,
		opts: { revalidate?: boolean },
		wake_children: () => void
	): void;
	after_fetch_exhausted(
		region: HTMLElement,
		opts: { revalidate?: boolean },
		wake_children: () => void
	): void;
};

// ── forms ────────────────────────────────────────────────────────────────
export type FormOps = {
	enabled: boolean;
	snapshot(root: ParentNode, pathKey: string): void;
	restore(pathKey: string): void;
};

// ── the rest (nullable — core reads with optional chaining) ────────────────
/** Wake a cold island when interaction lands inside it; returns a disarm fn (`over`: the region
 *  left while it was waking — the clicks it queued are dropped, not replayed). `fire` gets what
 *  replays the visitor's input (./interaction.ts `WakeFn`): the island goes live once it is in.
 *  `owner`: the region's lifetime in the page, which the replay's frame belongs to. */
export type ArmFn = (
	el: HTMLElement,
	fire: import('./interaction.ts').WakeFn,
	owner: Scope
) => void | ((over?: boolean) => void);

/** `target: 'walk'` = the hydration repair (the server sequence Svelte's walk binds); default = a live
 *  morph toward a new answer. Same ownership rules either way (runtime/ownership.ts). `stays`: a
 *  child of `parent` the morph steps over (the page's own, beside the render's). */
export type MorphFn = (
	parent: Element,
	nodes: ArrayLike<Node>,
	options?: { target?: 'live' | 'walk'; stays?: (node: Node) => boolean }
) => void;

export type WireOps = {
	/** THE hub key (`OgygiaRef`) — every transportable kind crosses under it. */
	REF_WIRE_KEY: string;
	/** Hub resolve: ref → live value (kind-dispatched; browser remembers, server never). */
	resolve: (ref: never, remember: boolean) => unknown;
};

export type RemoteSeedOps = {
	/** this document's remote seed into the query cache, once per document */
	seed_once(): void;
	seed_query_responses(text: string): void;
	clear_remote_seeds(): void;
	/** destroy the query instances only departed islands held (shims/kit-remote/remote-cache.ts) */
	release_remote_instances(): void;
};

/** The page as island code sees it, filled by the `page` feature (./seeds.ts). Null when no island
 *  code can read its page: the server ships no seed then, so there is nothing to parse or wait for. */
export type PageOps = {
	/** the document's page seed into the page store (once), then any page facts answers brought */
	seed_page_once(): void;
	/** the `page.data` a seed reference in island props resolves against */
	seed_data_of(doc: Document): unknown;
	/** on a Kit-hydrated document: the wait for Kit to apply its page (`null` once applied), for as
	 *  long as `signal` (the waiting region's visit) lasts */
	kit_page_thread(signal?: AbortSignal): Promise<unknown> | null;
};

/**
 * The client frame store, filled by the `frames` feature. Core reads it ONLY on the deferred /
 * live / SWR-lake paths (a region with a signed `endpoint`), so a plain load-hydrated app never
 * bundles the store. Null until the feature installs → core's frame calls are optional-chained.
 */
export type FrameOps = {
	subscribe(a: string, cb: (f: Frame) => void): () => void;
	/** `STALE` when its `signal` aborted: only that caller leaves the fetch. */
	ensure(
		a: string,
		fetcher: (signal: AbortSignal) => Promise<string>,
		opts?: { force?: boolean; signal?: AbortSignal }
	): Promise<string | Stale>;
	/** A renewal answered a fresh capability for this address; and the one it answered, if any. */
	renew(a: string, fresh: string): void;
	renewal(a: string): string | null;
	/**
	 * SINGLE-FLIGHT NAVIGATION: batch a page's signed deferred endpoints into the store as one streamed response. Lives
	 * on the seam (not a static router import) so an app with `router` but no deferred/live/lake region
	 * — hence no `frames` feature — never bundles the frame store. The router optional-chains this: no
	 * frames feature ⇒ no `render="defer"` holes to batch ⇒ the call never fires anyway. `visit`: the
	 * scope of the page the holes are for (./session.ts `PageVisit`); the batch stops when it ends.
	 */
	stream(endpoints: string[], visit: import('@ogygia/machine').Scope): Promise<void>;
	/** Holes that start fetching in the same task go out as one batch (frame-nav.ts `join_batch`);
	 *  await it, then `ensure` joins the batch's reservation. */
	join?(endpoint: string): Promise<void>;
	/** How the batch that carried a hole timed it (frame-nav.ts; the measuring browser only). */
	batch_times?(endpoint: string): { left: number; at: number; size: number } | undefined;
};

// ── nav ──────────────────────────────────────────────────────────────────
/**
 * SPA navigation, filled by the router feature. Read by the kit-remote client stub (used by the
 * always-on remote-seeds feature) so a remote COMMAND can navigate/invalidate WITHOUT the stub
 * statically importing `router.js` (~10 KB). Null when no router loaded → callers full-page fallback.
 */
export type NavOps = {
	goto(url: string | URL, opts?: unknown): Promise<void>;
	invalidateAll(): Promise<void>;
};

/**
 * BOOT → LAZY LINKS. The runtime's lazy chunks — the hydrate core, the router's navigation,
 * interaction replay — use a handful of boot helpers and the boot's session state. They reach them
 * HERE, never by importing a boot module: a module the boot and a lazy chunk both import is shared,
 * and Kit's client build (`preserveEntrySignatures: 'strict'`) forbids the runtime chunk from
 * exporting it, so the bundler splits every such module into a file of its own — the runtime's
 * boot arrived as nine. Each link is filled before its lazy chunk can load: `boot` by core's boot
 * (./boot-link.ts), `router_link` and `interaction_link` by the very loader that imports their chunk
 * (the router's `nav()`, interaction's `replay()`), `sync_attributes` by morph's install. Types only
 * below (erased), so this registry imports none of them.
 * `test/runtime-boot-svelte-free.test.ts` pins that no lazy chunk imports a boot module.
 */
export type BootLink = {
	kit_hydrates_page: typeof import('./kit-boot.ts').kit_hydrates_page;
	KitBoot: typeof import('./kit-boot.ts').KitBoot;
	ABSOLUTE_URL_SCHEME: RegExp;
	register_island_graph: typeof import('./island-graph-preload.ts').register_island_graph;
	is_warmed_module: typeof import('./region-endpoint-url.ts').is_warmed_module;
	warm_island_module: typeof import('./region-endpoint-url.ts').warm_island_module;
	note_entry_location: typeof import('./entry-locations.ts').note_entry_location;
	props_sidecar_of: typeof import('./sidecar.ts').props_sidecar_of;
	parse_region_html: typeof import('./parse-html.ts').parse_region_html;
	runtime_session: typeof import('./session.ts').runtime_session;
	regions_in_shadow: typeof import('./connected.ts').regions_in_shadow;
	/** the region sheets a navigation's head merge left, taken out but for those a region uses */
	release_sheets: typeof import('./region-sheets.ts').release_sheets;
	yield_task: typeof import('./schedule.ts').yield_task;
	/** the router's navigation, timed for the profiler's beacon (a no-op without it) */
	beacon_nav: typeof import('./beacon.ts').beacon_nav;
	/** the plugins around Svelte's hydrate over server markup (./client-plugins.ts) */
	region_hydrate: typeof import('./client-plugins.ts').client_region_hydrate;
	/** the load scheduler's queue (./load-scheduler.ts) */
	LoadSlot: typeof import('./load-scheduler.ts').LoadSlot;
	/** DOM ownership (./ownership.ts): which children Svelte's walk enters, and self-owned elements */
	walk_enters: typeof import('./ownership.ts').walk_enters;
	is_self_owned: typeof import('./ownership.ts').is_self_owned;
	/** `<body>`'s two owners (./ownership.ts): the router's record of what the server sent it */
	record_server_body: typeof import('./ownership.ts').record_server_body;
	server_body_attributes: typeof import('./ownership.ts').server_body_attributes;
	server_body_child: typeof import('./ownership.ts').server_body_child;
	/** devalue, loaded when a page needs it (./devalue-lane.ts) */
	load_devalue: typeof import('./devalue-lane.ts').load_devalue;
	devalue: typeof import('./devalue-lane.ts').devalue;
	with_devalue: typeof import('./devalue-lane.ts').with_devalue;
	needs_devalue: typeof import('./devalue-lane.ts').needs_devalue;
	/** the runtime's messages (../messages/core.ts), as a lazy chunk throws and logs them (../messages/lazy.ts) */
	OgygiaError: typeof import('../messages/core.ts').OgygiaError;
	warn: typeof import('../messages/core.ts').warn;
	/** what a machine's task answers once its visit is left (`@ogygia/machine`, which the boot runs on) */
	STALE: typeof import('@ogygia/machine').STALE;
	/** keyed shared async work (`@ogygia/machine`): the router's page fetches */
	flights: typeof import('@ogygia/machine').flights;
	/** a change built off to the side and switched in at once (`@ogygia/machine`): the router's
	 *  swap and the soft refresh */
	stage: typeof import('@ogygia/machine').stage;
	/** a stamp that only moves forward (`@ogygia/machine`): the world the router's page cache is
	 *  made in */
	world: typeof import('@ogygia/machine').world;
	/** the page's soft refresh (./soft-refresh.ts): `invalidateAll`, with the router or without it */
	soft: import('./soft-refresh.ts').SoftRefresh;
};
export type RouterLink = {
	jump_to_hash: typeof import('./router.ts').jump_to_hash;
};
export type InteractionLink = {
	resolve_address: typeof import('./interaction.ts').resolve_address;
};

export type Slots = {
	lakes: LakeOps;
	forms: FormOps;
	interaction: ArmFn | null;
	morph: MorphFn | null;
	/** props a live region or a kept island is hydrated with, pushed in place later (./live.ts) */
	Pushable: typeof import('./pushable-props.svelte.ts').PushableProps | null;
	wire: WireOps | null;
	/** The transportable classes an island's props, context and seeds need, loaded before it
	 *  decodes (./wire-classes.ts). Null in an app without transportable classes: nothing to load. */
	wire_classes: ((region: Element) => Promise<unknown> | null) | null;
	remoteSeeds: RemoteSeedOps | null;
	page: PageOps | null;
	frames: FrameOps | null;
	nav: NavOps | null;
	/**
	 * Cross-island context bridge, filled by the `context` feature. Walks the DOM from an island up
	 * to seed its `getContext` from a `<Provide>` / drop-in-`setContext` marker above it. Null when the
	 * build detected no ogygia context provider — a plain app never bundles the ~4.7 kB bridge, and
	 * core's call optional-chains to `undefined` (exactly "no provider above", the existing empty case).
	 */
	context: ((start: Element | null) => Map<string, unknown> | undefined) | null;
	/** Boot helpers + session for the lazy chunks (see {@link BootLink}). */
	boot: BootLink | null;
	/** The router's history/scroll helpers for its navigation chunk (see {@link RouterLink}). */
	router_link: RouterLink | null;
	/** Interaction's address resolver for its replay chunk (see {@link InteractionLink}). */
	interaction_link: InteractionLink | null;
	/** Morph's attribute sync, for the navigation's body reconcile. */
	sync_attributes: typeof import('./morph.ts').sync_attributes | null;
};

/** The live registry. A feature's `install()` assigns its slot; core/router read them. */
export const slots: Slots = {
	lakes: {
		on_frozen_connect: (el) => is_frozen(el),
		wait_for_boundary: () => false,
		lift: () => [],
		restore: () => {},
		settle_in: () => {},
		mark_frozen_settled: () => {},
		after_html_swap: () => {},
		after_fetch_exhausted: () => {}
	},
	forms: {
		enabled: false,
		snapshot: () => {},
		restore: () => {}
	},
	interaction: null,
	morph: null,
	Pushable: null,
	wire: null,
	wire_classes: null,
	remoteSeeds: null,
	page: null,
	frames: null,
	nav: null,
	context: null,
	boot: null,
	router_link: null,
	interaction_link: null,
	sync_attributes: null
};

/** A link a lazy chunk needs, or a loud error: every link is filled before its chunk can load, so a
 *  missing one means a chunk ran without the boot that owns it (a test that skipped `link_boot()`). */
function linked<T>(link: T | null, name: string): T {
	// (its code's link written out: every chunk imports this registry, so it imports no messages
	// module — messages/core.ts has the code)
	if (link === null)
		throw new Error('[ogygia] https://ogygiajs.dev/e/slot_not_linked?name=' + name);
	return link;
}
export const boot_link = (): BootLink => linked(slots.boot, 'boot');
export const router_link = (): RouterLink => linked(slots.router_link, 'router_link');
export const interaction_link = (): InteractionLink =>
	linked(slots.interaction_link, 'interaction_link');
export const morph_sync_attributes = (): NonNullable<Slots['sync_attributes']> =>
	linked(slots.sync_attributes, 'sync_attributes');
