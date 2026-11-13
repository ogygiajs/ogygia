/**
 * `CompileCtx` — the resolved compile context: the config the transform phase reads, plus its
 * derived naming accessors. A plain data holder constructed once the bundler has resolved the build
 * (root / dev / …) and the options are normalized (importKeys / presets / …). It is the config half
 * of the driver's session; the `Compiler` carries it into `transform()` so that phase never reaches
 * back into the Vite adapter — which is what keeps the driver bundler-agnostic.
 */
import { strip_bom } from './bom.ts';
import { node_fs, type Fs } from './fs.ts';
import { route_reader, type Routes } from './kit.ts';
import { islandVirtualId } from './ids.ts';
import { parse_module, type AstNode } from './parse/oxc.ts';
import type { ClientRealmFile, ServerRealm } from './link/caps.ts';
import type { AliasEntry, PluginMacro } from './macros/pipeline.ts';

/** A plugin's reader of the prescan (`b.prescan`): the modules it asked for, as the prescan reads
 *  them, and the end of a build. */
export interface PrescanHook {
	/** Only modules that import one of these specifiers are handed over. */
	readonly imports: readonly string[];
	/** One module the prescan read: its absolute path, its identity (package-relative in a package's
	 *  declared files, else relative to the app root; POSIX), its source. */
	module(m: { readonly file: string; readonly rel: string; readonly code: string }): void;
	/** A `vite build` wrote its client output (the last leg, on the main thread). */
	written?(): void;
}
import {
	islandChunkFileName,
	islandPublicUrl,
	STABLE_NAME_DIR,
	wrapperVirtualId,
	type ImportKeys
} from './region/transform.ts';

/** One dependency package's declared compile surface (`"ogygia": { "files": […] }` in ITS
 *  package.json) — produced by the plugin's discovery (`vite/package-files.ts`), consumed here
 *  type-only: the node:fs/glob work lives plugin-side.
 *  All paths are posix REALPATHS — Vite resolves ids through symlinks (pnpm), so gate matching
 *  must speak real paths or every check silently misses. */
export interface PackageScan {
	/** The package's published name — the stable identity prefix for its regions. */
	name: string;
	/** realpath of the package root. */
	root: string;
	/** Declared bare directories (prefix-matched, so files added mid-dev still count). */
	dirs: string[];
	/** Individually declared / glob-expanded files. */
	files: string[];
}

/** Windows separators → posix, for id matching against the (posix) declared-path index. */
const BACKSLASH_SEP = /\\/;
/** Matches nothing — the island-hint probe when no import keys are configured. */
const NEVER_MATCH_RE = /$^/;

export interface CompileCtxInit {
	root: string;
	base: string;
	/** SvelteKit `config.kit.appDir` (default `_app`) — the dir Kit emits AND serves its immutable
	 *  assets under. ogygia's runtime + island chunks MUST land here too: a custom appDir otherwise
	 *  404s them (Kit's adapter only maps `<appDir>/immutable/*` to the immutable-cache route). Read
	 *  from Kit's `__SVELTEKIT_APP_DIR__` build define; `_app` when Kit isn't present (standalone).
	 *  NOTE: only the app-internal PATH lives here. `base` / `paths.assets` (CDN) resolution is Kit's
	 *  `asset()`'s job — `Region.svelte` runs every baked entry / runtime URL through it at SSR — so
	 *  ogygia never bakes a base into these URLs (doing so double-applies it). */
	app_dir: string;
	libDir: string;
	/** A plugin asked for the build's measurement data (`b.measure()`: the profiler) — embedded maps,
	 *  per-island detail. */
	measure: boolean;
	/** The server halves of the app's plugins (module path + options), in app order — baked into
	 *  `ogygia:server/server-plugins`. Optional (default none). */
	server_plugins?: readonly ServerRealm[];
	/** The browser halves of the app's plugins (name, absolute module path), in app order —
	 *  imported by the runtime's boot. Optional (default none). */
	client_plugins?: readonly ClientRealmFile[];
	/** The keys the plugins claim inside Kit's `config` page option (`b.routeConfig`) — read from the
	 *  route files and baked into `ogygia:server/route-config`. Optional (default none). */
	route_config?: readonly string[];
	/** A plugin asked island entries to keep their foreign-hydrate exports (`b.foreignHydrate()`:
	 *  another app's runtime wakes this app's islands, and this app's pages carry other apps' regions:
	 *  the `foreign` runtime mark). Optional (default off). */
	foreign_hydrate?: boolean;
	/** Dependency packages that DECLARED their ogygia compile surface (`"ogygia": { "files": […] }`
	 *  in THEIR package.json) — prescanned + transformed like app source, node_modules gates lifted
	 *  for exactly these paths. Optional (default none). */
	pkg_scan?: PackageScan[];
	/** PAGE MODULES (`b.pageModules()`): modules that render pages outside Kit's routes, whose reachable
	 *  components get router-css. `page_importers`: a compiled module importing one of these specifiers
	 *  is one; `page_files`: absolute paths that are page modules themselves. Optional (default none). */
	page_importers?: readonly string[];
	page_files?: readonly string[];
	is_dev: boolean;
	id_salt: string;
	visibleMargin: string | undefined;
	presets: Record<string, unknown>;
	import_keys: ImportKeys;
	/** Resolved Vite aliases (an island's closure walk; every plugin macro gets them). */
	resolve_alias: readonly AliasEntry[];
	/** The plugins' `import.meta.og.*` macros (`b.macro`), in plugin order. Optional (default none). */
	macros?: readonly PluginMacro[];
	/** The plugins' prescan readers (`b.prescan`), in plugin order. Optional (default none). */
	prescans?: readonly PrescanHook[];
	/** The names of the plugins listed beside `ogygia()` (`'@ogygia/flags'`). Optional (default none). */
	plugins?: readonly string[];
	/** ogygia's own package root — the `auto_brand` macro skips ogygia source (it can't self-register). */
	pkg_root: string;

	// ── virtual-module emit config (read by `Compiler.emit`) ───────────────────────────────────────
	/** Per-build HMAC material baked into the SSR-only `ogygia:server/secret`. */
	build_secret: string;
	/** Region-endpoint rate limit (SSR-only), `{ max: 0 }` when disabled. */
	rate_limit: { max: number; windowMs: number };
	/** Cookie name sealed into the region MAC, or '' when unbound. */
	session_cookie: string;
	/** Capability-URL TTL in seconds. */
	region_ttl: number;
	/** How long after expiry an anonymous capability still renews, in seconds (`0` = never). */
	renew_window: number;
	/** Router on (app-wide). `false` tree-shakes the feature out. */
	router_enabled: boolean;
	/** View Transitions on for SPA navs. */
	router_view_transitions: boolean;
	/** The app's `src/hooks.client.{ts,js}` absolute path, or null — its `init` runs on boot for
	 *  csr=false pages (see runtime/client-hooks.ts). */
	client_hooks?: string | null;
	/** Package-internal absolute paths the emit inlines into generated virtual sources. */
	runtime_dir: string;
	runtime_hash: string;
	/** Kit's internal wire-protocol module (deep-imported by absolute path), or null: none found. */
	kit_wire_path?: string | null;
	client_binding_stub_file: string;
	/** `$app/*` → on-disk client-shim path map (island modules under csr=false). */
	app_shims: Record<string, string>;
	/** `command === 'build'` — gates the transform-time deterministic island-chunk emit. */
	is_build: boolean;
	/** Core's event emits compiled in (a plugin's `b.events()`: devtools). Bakes the standalone dock
	 *  boot for csr=true pages into `ogygia:server/devtools-boot-url`. */
	devtools: boolean;
	/** Where the app's files are read from (./fs.ts). Optional (default the disk). */
	fs?: Fs;
}

export class CompileCtx {
	/** Every read of the app's files goes through here (./fs.ts). */
	readonly fs: Fs;
	/** Kit's route worlds and route config, read through `fs` (one cache set per file system). */
	readonly routes: Routes;
	readonly root: string;
	readonly base: string;
	readonly app_dir: string;
	readonly libDir: string;
	readonly pkg_scan: PackageScan[];
	readonly page_importers: readonly string[];
	readonly page_files: readonly string[];
	readonly measure: boolean;
	readonly server_plugins: readonly ServerRealm[];
	readonly client_plugins: readonly ClientRealmFile[];
	readonly route_config: readonly string[];
	readonly foreign_hydrate: boolean;
	readonly is_dev: boolean;
	readonly id_salt: string;
	readonly visibleMargin: string | undefined;
	readonly presets: Record<string, unknown>;
	readonly import_keys: ImportKeys;
	readonly resolve_alias: readonly AliasEntry[];
	readonly macros: readonly PluginMacro[];
	readonly prescans: readonly PrescanHook[];
	readonly plugins: readonly string[];
	readonly pkg_root: string;
	readonly build_secret: string;
	readonly rate_limit: { max: number; windowMs: number };
	readonly session_cookie: string;
	readonly region_ttl: number;
	readonly renew_window: number;
	readonly router_enabled: boolean;
	readonly router_view_transitions: boolean;
	readonly client_hooks: string | null;
	readonly runtime_dir: string;
	readonly runtime_hash: string;
	readonly kit_wire_path: string | null;
	readonly client_binding_stub_file: string;
	readonly app_shims: Record<string, string>;
	readonly is_build: boolean;
	readonly devtools: boolean;
	/** `with { … }` hint matcher — a node_modules `.svelte` is only transformed when it carries one
	 *  (so a library can declare its own islands). Built once from the resolved import keys. */
	readonly #island_hint_re: RegExp;
	/** The resolved import-attribute keys that make a mark (`wake`, `render`, …). */
	readonly #mark_keys: ReadonlySet<string>;
	/** Declared package files (exact) + dirs (prefix) — the transform-gate membership index. */
	readonly #pkg_files: Set<string>;
	readonly #pkg_dirs: string[];
	/** Package roots, longest first, for stable-identity mapping (root → published name). */
	readonly #pkg_roots: Array<{ root: string; name: string }>;

	constructor(init: CompileCtxInit) {
		this.fs = init.fs ?? node_fs;
		this.routes = route_reader(this.fs);
		this.root = init.root;
		this.base = init.base;
		this.app_dir = init.app_dir;
		this.libDir = init.libDir;
		this.pkg_scan = init.pkg_scan ?? [];
		this.page_importers = init.page_importers ?? [];
		this.page_files = init.page_files ?? [];
		this.measure = init.measure;
		this.server_plugins = init.server_plugins ?? [];
		this.client_plugins = init.client_plugins ?? [];
		this.route_config = init.route_config ?? [];
		this.foreign_hydrate = init.foreign_hydrate ?? false;
		this.is_dev = init.is_dev;
		this.id_salt = init.id_salt;
		this.visibleMargin = init.visibleMargin;
		this.presets = init.presets;
		this.import_keys = init.import_keys;
		this.resolve_alias = init.resolve_alias;
		this.macros = init.macros ?? [];
		this.prescans = init.prescans ?? [];
		this.plugins = init.plugins ?? [];
		this.pkg_root = init.pkg_root;
		this.build_secret = init.build_secret;
		this.rate_limit = init.rate_limit;
		this.session_cookie = init.session_cookie;
		this.region_ttl = init.region_ttl;
		this.renew_window = init.renew_window;
		this.router_enabled = init.router_enabled;
		this.router_view_transitions = init.router_view_transitions;
		this.client_hooks = init.client_hooks ?? null;
		this.runtime_dir = init.runtime_dir;
		this.runtime_hash = init.runtime_hash;
		this.kit_wire_path = init.kit_wire_path ?? null;
		this.client_binding_stub_file = init.client_binding_stub_file;
		this.app_shims = init.app_shims;
		this.is_build = init.is_build;
		this.devtools = init.devtools;
		const hint_keys = Object.values(init.import_keys).filter(
			(v) => typeof v === 'string'
		) as string[];
		this.#island_hint_re = hint_keys.length
			? new RegExp(`\\bwith\\s*\\{[^}]*\\b(?:${hint_keys.join('|')})\\b`)
			: NEVER_MATCH_RE;
		this.#mark_keys = new Set(hint_keys);
		this.#pkg_files = new Set(this.pkg_scan.flatMap((p) => p.files));
		this.#pkg_dirs = this.pkg_scan.flatMap((p) => p.dirs);
		this.#pkg_roots = this.pkg_scan
			.map((p) => ({ root: p.root, name: p.name }))
			.sort((a, b) => b.root.length - a.root.length);
	}

	/** True when `code` carries an ogygia `with { … }` island hint (gates node_modules `.svelte`). */
	has_island_hint(code: string): boolean {
		return this.#island_hint_re.test(code);
	}

	/** True when a JS module has a real `import … with { <mark key>: … }` declaration. The hint
	 *  above is a text sniff, so it also matches a comment, a string or generated code that merely
	 *  mentions `with { wake }`; this parses. A module that does not parse counts as marked, so a
	 *  warning that depends on it errs toward speaking. */
	has_marked_import(code: string, id: string): boolean {
		const { program, ok } = parse_module(code, id);
		if (!ok || !program) return true;
		for (const node of program.body as AstNode[]) {
			if (node.type !== 'ImportDeclaration') continue;
			for (const attr of (node.attributes ?? []) as AstNode[]) {
				const key = attr.key?.type === 'Identifier' ? attr.key.name : attr.key?.value;
				if (typeof key === 'string' && this.#mark_keys.has(key)) return true;
			}
		}
		return false;
	}

	/** True when `id` is inside a dependency's DECLARED `ogygia.files` surface — those files are
	 *  prescanned + transformed exactly like app source (the node_modules gates lift for them). */
	in_declared_pkg(id: string): boolean {
		if (this.#pkg_files.size === 0 && this.#pkg_dirs.length === 0) return false;
		const p = id.split(BACKSLASH_SEP).join('/');
		if (this.#pkg_files.has(p)) return true;
		for (const dir of this.#pkg_dirs) if (p.startsWith(`${dir}/`)) return true;
		return false;
	}

	/** True for the app's own source (anything not installed: the app, its workspace packages,
	 *  virtual modules) and for a dependency's declared `ogygia.files`. */
	is_own_source(id: string): boolean {
		const p = id.split(BACKSLASH_SEP).join('/');
		return !p.includes('/node_modules/') || this.in_declared_pkg(p);
	}

	/** Install-independent region identity for a file under a declared package: `<name>/<rel>`.
	 *  Store paths carry version + peer-resolution hashes (`node_modules/.pnpm/pkg@1.2.3(...)`),
	 *  so a root-relative identity would change per install/machine and prod HTML would stop
	 *  matching its chunks. Returns `null` for anything not under a declared package root. */
	pkg_identity(abs: string): string | null {
		if (this.#pkg_roots.length === 0) return null;
		const p = abs.split(BACKSLASH_SEP).join('/');
		for (const { root, name } of this.#pkg_roots) {
			if (p.startsWith(`${root}/`)) return name + p.slice(root.length);
		}
		return null;
	}

	/** The runtime's feature set, as a name segment: the prescan's feature hash, and a trailing `h` when
	 *  the app has `hooks.client.ts` (the runtime entry then dynamic-imports it). Empty until prescan
	 *  runs. Both the stable name and the content-hashed file carry it, so a name says which runtime. */
	runtime_features(program_feature_hash: string): string {
		return `${program_feature_hash}${this.client_hooks ? 'h' : ''}`;
	}

	/** The runtime's STABLE name (`RUNTIME_HASH` ⊕ its features): its identity — the key the handoff
	 *  maps to the content-hashed file the page loads (a name, not a file). Computed here
	 *  (not the caller) so both build legs name it identically. `program_feature_hash` is the scan's
	 *  `Scan.feature_hash`, threaded in by the caller so this stays a pure naming function. */
	runtime_chunk_filename(program_feature_hash: string): string {
		const feat = this.runtime_features(program_feature_hash);
		return `${this.app_dir}/${STABLE_NAME_DIR}/og-runtime.${this.runtime_hash}${feat ? `-${feat}` : ''}.js`;
	}

	/** App-internal URL of the runtime chunk (leading slash + appDir; NO base). SSR bakes it as the
	 *  `<script src>`, then `asset()` prepends base / the assets CDN at render time. */
	runtime_chunk_url(program_feature_hash: string): string {
		return `/${this.runtime_chunk_filename(program_feature_hash)}`;
	}

	/** Output filename for a hydrate island chunk (under the app dir; an on-disk build path). */
	island_chunk_filename(iid: string): string {
		return islandChunkFileName(iid, this.app_dir);
	}

	/** App-internal URL of a hydrate island chunk (leading slash + appDir; NO base — `asset()` adds it). */
	island_public_url(iid: string): string {
		return islandPublicUrl(iid, this.app_dir);
	}

	/** Read a file as UTF-8, or `null` if it can't be read (the transform tolerates missing deps). */
	read_file(abs: string): string | null {
		const text = this.fs.read(abs);
		return text === null ? null : strip_bom(text);
	}

	/** Virtual island ENTRY module id for an island id. */
	island_virtual_id(iid: string): string {
		return islandVirtualId(iid);
	}

	/** Virtual wrapper `.svelte` module id for an island id. */
	wrapper_virtual_id(iid: string): string {
		return wrapperVirtualId(iid);
	}

	/** Dev URL for a dynamic `import(entry)` of a virtual island module. Base-LESS, exactly like the
	 *  prod island/runtime URLs and the dev runtime URL: `Region.svelte` runs it through Kit's `asset()`
	 *  at SSR, which is the sole base authority. Baking `base` here would double it (Vite dev serves
	 *  `/@id/…` UNDER base, and `asset()` already adds that prefix). */
	dev_url_for(virtualPath: string): string {
		return `/@id/${virtualPath}`;
	}
}
