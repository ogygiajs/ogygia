/**
 * The shapes of the virtual modules whose source the compiler generates as code (the table's
 * families, ../compiler/virtual/core.ts): what each exports, written once. The generated per-realm
 * `.d.ts` files point at these; the code that imports a module reads its types from here.
 */
import type { ServerPluginEntry } from '../plugin/server.ts';

/** A Kit transport hook's codecs, by type name. */
export type CodecMap = Record<
	string,
	{ encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }
>;

/** What the build learned about each region's client code, read at render time from its handoff.
 *  (Its function names are the module's existing exports; they say island, and rename with them.) */
export interface RegionDepsModule {
	/** Public URLs of hashed dependency chunks for a hydrate island entry (`/_app/immutable/…`). */
	islandDeps(entry: string): string[];
	/** WAKE ADVISOR: what the island's own components do, from the build; `null` without facts. */
	islandInteractivity(entry: string): {
		handlers: number;
		state: number;
		effects: number;
		binds: number;
		actions: number;
		files: number;
	} | null;
	/** a hashed client chunk's source modules, app files first; `null` when the handoff has none */
	chunkContents(href: string): string[] | null;
	/** a chunk's heaviest named modules with their rendered bytes (profiler builds only) */
	chunkHeavy(href: string): { total: number; top: { name: string; bytes: number }[] } | null;
	/** the modules the build shipped as two copies, each copy's chunk and bytes (profiler builds) */
	chunkDuplicates():
		| { name: string; copies: { file: string; bytes: number; from?: string }[] }[]
		| null;
	/** the re-export barrels a chunk still holds, with how many modules each brings (profiler builds) */
	chunkBarrels(href: string): { name: string; fanout: number }[] | null;
	/** an island's components' lines that draw differently in the browser (the build's scan) */
	islandHazards(
		entry: string
	):
		| { file: string; line: number; code: string; kind: 'await' | 'browser'; reads?: string }[]
		| null;
	/** Public URLs of the CSS assets an island entry (+ its dep chunks) owns. */
	islandCss(entry: string): string[];
	/** Public URLs of the CSS a content page's own components own (by content id). */
	contentCss(id: string): string[];
	/** The text of a region CSS asset the build kept under Kit's `inlineStyleThreshold`; `null` = link it. */
	islandCssInline(href: string): string | null;
	/** The island's client code reads `$page` (fail-open: true in dev and for an unknown entry). */
	islandReadsPage(entry: string): boolean;
	/** The top-level `page.data` keys the island's client code reads; `null` = ship all. */
	islandPageKeys(entry: string): string[] | null;
	/** why an island ships all of page.data: the modules whose reads the build could not pin */
	islandPageWhy(entry: string): { file: string; line: number | null; why: string }[] | null;
	/** The Kit remote-function modules (by id-hash) the island can call; `null` = may call anything. */
	islandRemotes(entry: string): string[] | null;
	/** og.$ hoisted factories (tag → source) for the page-inline registration; prod SSR only. */
	fnManifest(): Record<string, string> | null;
	/** An entry's identity (its stable URL) → the content-hashed file it is served from. */
	entryLocation(identity: string): string | null;
	/** The build's location map file (base-less served path), or `null`: none built. */
	locationMap(): string | null;
}

/** The server islands this build has, and how to reach each one. */
export interface ServerManifestModule {
	/** The server islands' loaders, one dynamic import away (link/server-manifest.ts says why). */
	load_islands(): Promise<ServerRegionsModule>;
	/** Server-island id → its built client-chunk URL (the key `islandCss()` is keyed by). */
	island_url: Record<string, string>;
	/** Server-island id → its component name, where the component file is known. */
	island_name: Record<string, string>;
	/** Server-island id → its render identity (the component it renders), signed into its capabilities. */
	island_render: Record<string, string>;
	/** Render identity → a server-island id of this build that renders it. */
	render_island: Record<string, string>;
	/** Server-island id → its server tree reads `page.data`; `null` in dev (unknown). */
	island_reads_page_data: Record<string, boolean> | null;
}

export interface ServerRegionsModule {
	/** server-region id → its loader */
	islands: Record<string, () => Promise<{ default: unknown }>>;
}

export interface TransportModule {
	transport: CodecMap;
	encoders: Record<string, (v: unknown) => unknown>;
	decoders: Record<string, (v: unknown) => unknown>;
}

export interface KitTransportModule {
	transport: CodecMap;
}

export interface HydrateFeaturesModule {
	/** installs the hydrate-phase features the app's marks selected */
	install(): void;
}

export interface RuntimeFlagsModule {
	/** the `frames` feature is in the build: some region streams HTML */
	FRAMES: boolean;
}

export interface TransportablesModule {
	/** client: a transportable class module's tag path → its lazy import (server: empty, eager) */
	wire_loaders: Record<string, () => Promise<unknown>>;
	/** client: the app sends wired values through Kit's transport: every class loads with every island */
	wire_all: boolean;
}

export interface ServerPluginsModule {
	/** the server halves of the plugins listed beside `ogygia()`, in plugin order */
	plugins: readonly ServerPluginEntry[];
}

export interface RouteConfigModule {
	/** every Kit page route id → the keys plugins claim inside its `config` page option, merged */
	route_config: Record<string, Record<string, unknown>>;
}

/** Kit's own wire protocol (its transport-aware devalue codec), deep-imported. */
export interface KitWireModule {
	stringify_remote_arg(value: unknown, transport: unknown): string;
	stringify_command_arg(value: unknown, transport: unknown): Promise<string>;
	create_remote_key(id: string, payload: string): string;
}

/** A module that only runs (it exports nothing). */
export type SideEffectModule = Record<never, never>;
