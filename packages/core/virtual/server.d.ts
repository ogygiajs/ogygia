// The `ogygia:server/…` modules. GENERATED from the virtual-module table
// (packages/core/src/compiler/virtual/core.ts): change an entry's `types` there, then run
// `node packages/core/scripts/virtual-types.ts`. A test fails while this file is stale.

declare module 'ogygia:server/runtime-url' {
	const url: string;
	export default url;
}
declare module 'virtual:ogygia/runtime-url' {
	const url: string;
	export default url;
}

declare module 'ogygia:server/dev-hmr-url' {
	const url: string;
	export default url;
}
declare module 'virtual:ogygia/dev-hmr-url' {
	const url: string;
	export default url;
}

declare module 'ogygia:server/devtools-boot-url' {
	const url: string;
	export default url;
}
declare module 'virtual:ogygia/devtools-boot-url' {
	const url: string;
	export default url;
}

declare module 'ogygia:server/island-deps' {
	/** Public URLs of hashed dependency chunks for a hydrate island entry (`/_app/immutable/…`). */
	export function islandDeps(entry: string): string[];
	/** WAKE ADVISOR: what the island's own components do (handlers, `$state`, `$effect`, `bind:`,
	 *  `use:` counts over its closure), from the build; `null` when the handoff has no facts. */
	export function islandInteractivity(entry: string): {
		handlers: number;
		state: number;
		effects: number;
		binds: number;
		actions: number;
		files: number;
	} | null;
	/** WHAT IS INSIDE a hashed client chunk (an `islandDeps()` href): a short readable list of its
	 *  source modules — app files first, then packages; `null` when the handoff has none (dev). */
	export function chunkContents(href: string): string[] | null;
	/** a chunk's heaviest named modules with their rendered bytes (profiler builds only) */
	export function chunkHeavy(href: string): { total: number; top: { name: string; bytes: number }[] } | null;
	/** the modules the build shipped as two copies (one package file by two paths), each copy's chunk
	 *  and its bytes (profiler builds only; null when none) */
	export function chunkDuplicates(): { name: string; copies: { file: string; bytes: number; from?: string }[] }[] | null;
	/** the re-export barrels a chunk still holds, with how many modules each brings (profiler builds only) */
	export function chunkBarrels(href: string): { name: string; fanout: number }[] | null;
	/** an island entry's components' lines that draw differently in the browser (the build's scan) */
	export function islandHazards(entry: string): { file: string; line: number; code: string; kind: 'await' | 'browser'; reads?: string }[] | null;
	/** Public URLs of the CSS assets an island entry (+ its dep chunks) owns — carried with a region
	 *  response so a server-picked component styles a page that never imported it. */
	export function islandCss(entry: string): string[];
	/** Public URLs of the CSS a content page's own components own (by content id). */
	export function contentCss(id: string): string[];
	/** INLINE REGION CSS: the text of a region CSS asset (an `islandCss()` / `contentCss()` href) the
	 *  build kept under Kit's `inlineStyleThreshold`, so the render emits it as a `<style>` instead of
	 *  a blocking `<link>`. `null` = link it (over the threshold, no threshold, dev). */
	export function islandCssInline(href: string): string | null;
	/** Does this island entry's client code read `$page`? Decides whether the page seed ships.
	 *  Fail-open: true in dev and for an entry the build handoff does not know. */
	export function islandReadsPage(entry: string): boolean;
	/** SEED SHAPING: the top-level `page.data` keys this island entry's client code reads, so the
	 *  handle ships only those. `null` = ship all: dev, an entry the handoff does not know, or a
	 *  closure whose reads could not be pinned to literal keys. */
	export function islandPageKeys(entry: string): string[] | null;
	/** why an island ships all of page.data: the modules whose reads the build could not pin */
	export function islandPageWhy(entry: string): { file: string; line: number | null; why: string }[] | null;
	/** The Kit remote-function modules (by id-hash) an island entry's client code can call. Fail-open:
	 *  `null` ("may call anything") in dev and for an entry the build handoff does not know. */
	export function islandRemotes(entry: string): string[] | null;
	/** og.$ hoisted factories (tag → self-contained source) for the page-inline registration script —
	 *  prod SSR only; null in dev/client (dev uses the fn-manifest module). */
	export function fnManifest(): Record<string, string> | null;
	/** An entry's identity (its stable URL) → the content-hashed file it is served from; `null`: none known. */
	export function entryLocation(identity: string): string | null;
	/** The build's location map file (base-less served path), or `null`: none built. */
	export function locationMap(): string | null;
}
declare module 'virtual:ogygia/island-deps' {
	/** Public URLs of hashed dependency chunks for a hydrate island entry (`/_app/immutable/…`). */
	export function islandDeps(entry: string): string[];
	/** WAKE ADVISOR: what the island's own components do (handlers, `$state`, `$effect`, `bind:`,
	 *  `use:` counts over its closure), from the build; `null` when the handoff has no facts. */
	export function islandInteractivity(entry: string): {
		handlers: number;
		state: number;
		effects: number;
		binds: number;
		actions: number;
		files: number;
	} | null;
	/** WHAT IS INSIDE a hashed client chunk (an `islandDeps()` href): a short readable list of its
	 *  source modules — app files first, then packages; `null` when the handoff has none (dev). */
	export function chunkContents(href: string): string[] | null;
	/** a chunk's heaviest named modules with their rendered bytes (profiler builds only) */
	export function chunkHeavy(href: string): { total: number; top: { name: string; bytes: number }[] } | null;
	/** the modules the build shipped as two copies (one package file by two paths), each copy's chunk
	 *  and its bytes (profiler builds only; null when none) */
	export function chunkDuplicates(): { name: string; copies: { file: string; bytes: number; from?: string }[] }[] | null;
	/** the re-export barrels a chunk still holds, with how many modules each brings (profiler builds only) */
	export function chunkBarrels(href: string): { name: string; fanout: number }[] | null;
	/** an island entry's components' lines that draw differently in the browser (the build's scan) */
	export function islandHazards(entry: string): { file: string; line: number; code: string; kind: 'await' | 'browser'; reads?: string }[] | null;
	/** Public URLs of the CSS assets an island entry (+ its dep chunks) owns — carried with a region
	 *  response so a server-picked component styles a page that never imported it. */
	export function islandCss(entry: string): string[];
	/** Public URLs of the CSS a content page's own components own (by content id). */
	export function contentCss(id: string): string[];
	/** INLINE REGION CSS: the text of a region CSS asset (an `islandCss()` / `contentCss()` href) the
	 *  build kept under Kit's `inlineStyleThreshold`, so the render emits it as a `<style>` instead of
	 *  a blocking `<link>`. `null` = link it (over the threshold, no threshold, dev). */
	export function islandCssInline(href: string): string | null;
	/** Does this island entry's client code read `$page`? Decides whether the page seed ships.
	 *  Fail-open: true in dev and for an entry the build handoff does not know. */
	export function islandReadsPage(entry: string): boolean;
	/** SEED SHAPING: the top-level `page.data` keys this island entry's client code reads, so the
	 *  handle ships only those. `null` = ship all: dev, an entry the handoff does not know, or a
	 *  closure whose reads could not be pinned to literal keys. */
	export function islandPageKeys(entry: string): string[] | null;
	/** why an island ships all of page.data: the modules whose reads the build could not pin */
	export function islandPageWhy(entry: string): { file: string; line: number | null; why: string }[] | null;
	/** The Kit remote-function modules (by id-hash) an island entry's client code can call. Fail-open:
	 *  `null` ("may call anything") in dev and for an entry the build handoff does not know. */
	export function islandRemotes(entry: string): string[] | null;
	/** og.$ hoisted factories (tag → self-contained source) for the page-inline registration script —
	 *  prod SSR only; null in dev/client (dev uses the fn-manifest module). */
	export function fnManifest(): Record<string, string> | null;
	/** An entry's identity (its stable URL) → the content-hashed file it is served from; `null`: none known. */
	export function entryLocation(identity: string): string | null;
	/** The build's location map file (base-less served path), or `null`: none built. */
	export function locationMap(): string | null;
}

declare module 'ogygia:server/router-css' {}
declare module 'virtual:ogygia/router-css' {}

declare module 'ogygia:server/secret' {
	/** this build's random key material (server leg; '' on the client) */
	export const buildKey: string;
	/** the build saw an `OGYGIA_SECRET` (its region ids are salted from it) */
	export const buildHadSecret: boolean;
}
declare module 'virtual:ogygia/secret' {
	/** this build's random key material (server leg; '' on the client) */
	export const buildKey: string;
	/** the build saw an `OGYGIA_SECRET` (its region ids are salted from it) */
	export const buildHadSecret: boolean;
}

declare module 'ogygia:server/sign' {
	export function sign(secret: string, message: string): string;
	export function verify(secret: string, message: string, sig: string): boolean;
	export function region_mac_message(id: string, exp: number | string, props: string, session?: string, ttl?: number | string, render?: string): string;
}
declare module 'virtual:ogygia/sign' {
	export function sign(secret: string, message: string): string;
	export function verify(secret: string, message: string, sig: string): boolean;
	export function region_mac_message(id: string, exp: number | string, props: string, session?: string, ttl?: number | string, render?: string): string;
}

declare module 'ogygia:server/request-event' {
	export function getRequestEvent(): {
		cookies: { get: (name: string) => string | undefined };
		request: Request;
		[key: string]: unknown;
	};
}
declare module 'virtual:ogygia/request-event' {
	export function getRequestEvent(): {
		cookies: { get: (name: string) => string | undefined };
		request: Request;
		[key: string]: unknown;
	};
}

declare module 'ogygia:server/kit-wire' {
	export function stringify_remote_arg(value: unknown, transport: unknown): string;
	export function stringify_command_arg(value: unknown, transport: unknown): Promise<string>;
	export function create_remote_key(id: string, payload: string): string;
}
declare module 'virtual:ogygia/kit-wire' {
	export function stringify_remote_arg(value: unknown, transport: unknown): string;
	export function stringify_command_arg(value: unknown, transport: unknown): Promise<string>;
	export function create_remote_key(id: string, payload: string): string;
}

declare module 'ogygia:server/rate-limit' {
	/** `max: 0` disables. Baked from `ogygia({ rateLimit })`. */
	export const rateLimit: { max: number; windowMs: number };
}
declare module 'virtual:ogygia/rate-limit' {
	/** `max: 0` disables. Baked from `ogygia({ rateLimit })`. */
	export const rateLimit: { max: number; windowMs: number };
}

declare module 'ogygia:server/server-plugins' {
	/** the server halves of the plugins listed beside `ogygia()`, in plugin order (the client: none) */
	export const plugins: readonly { name: string; options: unknown; server: object }[];
}
declare module 'virtual:ogygia/server-plugins' {
	/** the server halves of the plugins listed beside `ogygia()`, in plugin order (the client: none) */
	export const plugins: readonly { name: string; options: unknown; server: object }[];
}

declare module 'ogygia:server/profiler-maps' {
	/** the server build's module map and chunk sourcemaps as one string (filled after the build), or
	 *  null outside a profiler-on server build */
	const maps: string | null;
	export default maps;
}
declare module 'virtual:ogygia/profiler-maps' {
	/** the server build's module map and chunk sourcemaps as one string (filled after the build), or
	 *  null outside a profiler-on server build */
	const maps: string | null;
	export default maps;
}

declare module 'ogygia:server/router-config' {
	/** the SPA router is on (default), or off: `ogygia({ router: false })` */
	export const enabled: boolean;
	/** navigations use the View Transitions API: `ogygia({ router: { viewTransitions } })` */
	export const viewTransitions: boolean;
}
declare module 'virtual:ogygia/router-config' {
	/** the SPA router is on (default), or off: `ogygia({ router: false })` */
	export const enabled: boolean;
	/** navigations use the View Transitions API: `ogygia({ router: { viewTransitions } })` */
	export const viewTransitions: boolean;
}

declare module 'ogygia:server/session-cookie' {
	/** the cookie name sealed into the region MAC, or '' (`ogygia({ sessionCookie })`) */
	export const sessionCookie: string;
}
declare module 'virtual:ogygia/session-cookie' {
	/** the cookie name sealed into the region MAC, or '' (`ogygia({ sessionCookie })`) */
	export const sessionCookie: string;
}

declare module 'ogygia:server/region-ttl' {
	/** capability URL TTL in seconds (`ogygia({ ttl })`, default 3600) */
	export const regionTtl: number;
	/** seconds after expiry an anonymous capability still renews (`ogygia({ maxPageAge })`) */
	export const renewWindow: number;
}
declare module 'virtual:ogygia/region-ttl' {
	/** capability URL TTL in seconds (`ogygia({ ttl })`, default 3600) */
	export const regionTtl: number;
	/** seconds after expiry an anonymous capability still renews (`ogygia({ maxPageAge })`) */
	export const renewWindow: number;
}

declare module 'ogygia:server/route-csr' {
	/** route ids (group-stripped) whose effective csr is true */
	export const csr_true_routes: ReadonlySet<string>;
	/** route ids whose ERROR render is hydrated (the layouts' csr; the page's option ignored) */
	export const error_csr_true_routes: ReadonlySet<string>;
	/** the routeless error render: the root layout's own csr (Kit's default `true`) */
	export const root_layout_csr_true: boolean;
}
declare module 'virtual:ogygia/route-csr' {
	/** route ids (group-stripped) whose effective csr is true */
	export const csr_true_routes: ReadonlySet<string>;
	/** route ids whose ERROR render is hydrated (the layouts' csr; the page's option ignored) */
	export const error_csr_true_routes: ReadonlySet<string>;
	/** the routeless error render: the root layout's own csr (Kit's default `true`) */
	export const root_layout_csr_true: boolean;
}

declare module 'ogygia:server/route-config' {
	/** every Kit page route id → the keys plugins claim inside its `config` page option, merged */
	export const route_config: Record<string, Record<string, unknown>>;
}
declare module 'virtual:ogygia/route-config' {
	/** every Kit page route id → the keys plugins claim inside its `config` page option, merged */
	export const route_config: Record<string, Record<string, unknown>>;
}

declare module 'ogygia:server/server-manifest' {
	/** The server islands' loaders, one dynamic import away (link/server-manifest.ts says why). */
	export function load_islands(): Promise<typeof import('virtual:ogygia/server-islands')>;
	/** Server-island id → its built client-chunk URL (the key `islandCss()` is keyed by). Its keys are
	 *  the server islands this build has. */
	export const island_url: Record<string, string>;
	/** Server-island id → its component name (`SlowHole`), where the component file is known. */
	export const island_name: Record<string, string>;
	/** Server-island id → its render identity (the component it renders), signed into its capabilities. */
	export const island_render: Record<string, string>;
	/** Render identity → a server-island id of this build that renders it: answers a capability minted
	 *  by another build, whose id this one does not have. */
	export const render_island: Record<string, string>;
	/** Server-island id → its server tree reads `page.data` (the build's answer); `null` in dev:
	 *  unknown, so every hole looks its page up. */
	export const island_reads_page_data: Record<string, boolean> | null;
}
declare module 'virtual:ogygia/server-manifest' {
	/** The server islands' loaders, one dynamic import away (link/server-manifest.ts says why). */
	export function load_islands(): Promise<typeof import('virtual:ogygia/server-islands')>;
	/** Server-island id → its built client-chunk URL (the key `islandCss()` is keyed by). Its keys are
	 *  the server islands this build has. */
	export const island_url: Record<string, string>;
	/** Server-island id → its component name (`SlowHole`), where the component file is known. */
	export const island_name: Record<string, string>;
	/** Server-island id → its render identity (the component it renders), signed into its capabilities. */
	export const island_render: Record<string, string>;
	/** Render identity → a server-island id of this build that renders it: answers a capability minted
	 *  by another build, whose id this one does not have. */
	export const render_island: Record<string, string>;
	/** Server-island id → its server tree reads `page.data` (the build's answer); `null` in dev:
	 *  unknown, so every hole looks its page up. */
	export const island_reads_page_data: Record<string, boolean> | null;
}

declare module 'ogygia:server/server-islands' {
	/** server-island id → its loader */
	export const islands: Record<string, () => Promise<{ default: unknown }>>;
}
declare module 'virtual:ogygia/server-islands' {
	/** server-island id → its loader */
	export const islands: Record<string, () => Promise<{ default: unknown }>>;
}
