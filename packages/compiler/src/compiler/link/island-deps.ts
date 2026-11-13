/**
 * Whole-program island dependency collection — from a finished client bundle, the transitive static
 * import + CSS chains for each `og-region.<id>.js` facade, so SSR can `modulepreload` a hydrate
 * island's hashed dependency chunks (Vite's auto graph does not cover `@vite-ignore` `import(entry)`).
 * Pure over the bundle it is handed. Covered by unit tests.
 */
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import { merge_page_keys, type PageKeys } from './page-keys.ts';
import {
	hydration_hazards,
	OWN_FILE_RE,
	OWN_PACKAGE_NAMES,
	type IslandHazard
} from '@ogygia/core/contract';
import { is_generated_specifier } from '../virtual/table.ts';

/** The server module's string slot the client leg writes the deps JSON into (link/relocations.ts). */
export const ISLAND_DEPS_INLINE_TOKEN = '__OGYGIA_ISLAND_DEPS_INLINE__';

/** Deterministic island facade filename (content-hashed Vite deps are separate). */
const ISLAND_FACADE_RE = /(?:^|\/)og-region\.[0-9a-f]+\.js$/;
const LEADING_SLASH = /^\//;
/** A Kit remote-function module (`*.remote.js` / `.ts`, Kit's `moduleExtensions` defaults), once
 *  its `?query` is stripped. In the CLIENT graph Kit swaps its body for fetching stubs, but the
 *  module keeps its file id — which is how an island's chunk closure names the remotes it can call. */
const REMOTE_MODULE_RE = /\.remote\.[cm]?[jt]s$/;
const BACKSLASH_G = /\\/g;

/**
 * Kit's own `hash()` (`@sveltejs/kit/src/utils/hash.js`: djb2 ×33 xor, unsigned, base36) — the
 * function a remote's id is minted with: `${hash(file)}/${exportName}`, `file` the module's path
 * relative to `process.cwd()`, posix. Mirrored here (Kit does not export it) so the build can
 * name a remote by the same id the server sees on `internals.id` at render time. Covered by a
 * vector test against ids observed from a real Kit build.
 */
export function kit_remote_hash(file: string): string {
	let hash = 5381;
	let i = file.length;
	while (i) hash = (hash * 33) ^ file.charCodeAt(--i);
	return (hash >>> 0).toString(36);
}

/**
 * The Kit remote id-hash of a CLIENT module id, or `null` for a module that is not a remote file.
 * `cwd` is what Kit hashed the file against (`process.cwd()` at build), either separator.
 *
 * @internal Exported for the plugin and unit tests.
 */
export function remote_hash_of(module_id: string, cwd: string): string | null {
	const id = module_id.split('?')[0].replace(BACKSLASH_G, '/');
	if (!REMOTE_MODULE_RE.test(id)) return null;
	const root = cwd.replace(BACKSLASH_G, '/').replace(TRAILING_SLASH_RE, '');
	const rel = id.startsWith(`${root}/`) ? id.slice(root.length + 1) : path.posix.relative(root, id);
	return kit_remote_hash(rel);
}
const TRAILING_SLASH_RE = /\/+$/;

/**
 * From a client `generateBundle` output, collect transitive static `imports` for each
 * `og-region.<id>.js` facade. Keys/values are public URLs (`/_app/immutable/…`).
 * Used so SSR can `modulepreload` hashed dependency chunks for `hydrate: 'load'` islands
 * (Vite’s auto graph does not apply to `@vite-ignore` `import(entry)`).
 *
 * @internal Exported for unit tests.
 */
export function collectIslandDepModulepreloads(
	bundle: Record<
		string,
		{
			type: string;
			fileName?: string;
			imports?: string[];
			dynamicImports?: string[];
			/** The source module ids bundled into this chunk (Rollup/rolldown `OutputChunk`). */
			moduleIds?: string[];
			/** Vite/rolldown-vite chunk metadata — `importedCss` lists the CSS assets a chunk owns. */
			viteMetadata?: { importedCss?: Set<string> | string[] };
		}
	>,
	/**
	 * Source files whose presence in an island's chunk closure means the island READS THE PAGE
	 * (the `$app/state` / `$app/stores` shims). Per entry, `page[entryUrl]` says whether any chunk
	 * in its closure bundles one of them — what lets the handle skip the page seed on a page whose
	 * islands never read it. Absolute paths, either separator.
	 */
	page_reader_files: readonly string[] = [],
	/**
	 * Names a bundled module's Kit remote id-hash (`remote_hash_of`), or `null` for a module that is
	 * no remote file. Per entry, `remotes[entryUrl]` lists every remote module in the island's chunk
	 * closure — static AND dynamic imports, since a remote called after an `await import()` is still
	 * this island's call — which is what lets the handle seed a remote's SSR result only when some
	 * island on the page can call it (REMOTE SEED ONLY WHEN REACHABLE). Absent → every entry `[]`.
	 */
	remote_hash: ((module_id: string) => string | null) | null = null,
	/**
	 * SEED SHAPING: the top-level `page.data` keys a bundled module reads (link/page-keys.ts, recorded
	 * by the transform), `'all'` when its reads could not be pinned, `null` for a module that never
	 * imports the page. Per entry, `page_keys[entryUrl]` is the union over its chunk closure — the
	 * keys the handle ships — or `null` (ship all) when any module said `'all'`, or when the closure
	 * reads the page through a module the transform never saw. Absent → every reader `null`.
	 */
	page_keys_of: ((module_id: string) => PageKeys | null) | null = null,
	/**
	 * WAKE ADVISOR: reads a bundled `.svelte` source by id so the collector can count what the
	 * island's components do (handlers, `$state`, `bind:`…). Per entry, `interactivity[entryUrl]`
	 * is the union over its closure's own components (dependencies and ogygia's wrappers skipped).
	 * Absent → no facts (the profiler shows none).
	 */
	read_source: ((id: string) => string | null) | null = null,
	/**
	 * The runtime entry chunk's exact file name (compiler `runtime_chunk_filename`). Its static
	 * imports are recorded under its URL so SSR hints them beside the runtime script. Matched EXACTLY,
	 * never by pattern: the name is ours, and a hand-written pattern drifts from it (the `h` suffix a
	 * `hooks.client` app gets was missed, and such apps shipped the runtime with no preloads).
	 * Absent (`null`) → no runtime entry.
	 */
	runtime_file: string | null = null,
	/**
	 * IDENTITY vs LOCATION: which emitted file is which entry. An island entry and the runtime are
	 * content-hashed files; every map below is keyed by their IDENTITY (the stable public URL SSR bakes,
	 * `island_public_url` / the runtime's stable URL), never by the hashed name. `islands`: hashed
	 * file name → identity; `runtime`: the runtime's identity (its file is `runtime_file`). Absent →
	 * a file under the stable name is its own identity (the shape before hashing, and the unit tests').
	 */
	entries: { islands: ReadonlyMap<string, string>; runtime: string | null } | null = null
): {
	js: Record<string, string[]>;
	css: Record<string, string[]>;
	page: Record<string, boolean>;
	page_keys: Record<string, string[] | null>;
	remotes: Record<string, string[]>;
	interactivity: Record<string, IslandInteractivityFacts>;
	/** each island's components' lines that draw differently in the browser (hydration-hazards.ts),
	 *  by entry — the app's own and the site kit's (ogygia's content components); not other packages */
	hazards: Record<string, IslandHazard[]>;
	/** what is inside each chunk an island pulls: a readable source list per public href */
	contents: Record<string, string[]>;
	/** each chunk's heaviest named modules with their rendered bytes (a package sums its modules):
	 *  what the report names as most of an island's code. Apart from `contents`, which stays names
	 *  only (a chunk's identity across builds) */
	heavy: Record<string, ChunkHeavy>;
	/** modules the build shipped as two copies (one package file by two paths), each copy's chunk */
	dupes: DuplicateModule[];
} {
	const js: Record<string, string[]> = {};
	const css: Record<string, string[]> = {};
	const page: Record<string, boolean> = {};
	const page_keys: Record<string, string[] | null> = {};
	const remotes: Record<string, string[]> = {};
	const interactivity: Record<string, IslandInteractivityFacts> = {};
	const hazards: Record<string, IslandHazard[]> = {};
	// (per file, once: the lines, with a label a reader knows — from `src/`, or the site kit's)
	const hazards_cache = new Map<string, IslandHazard[]>();
	const hazards_of = (id: string): IslandHazard[] => {
		if (!read_source) return [];
		const clean = norm(id.split('?')[0]);
		if (!clean.endsWith('.svelte') || (OWN_OR_DEP_RE.test(clean) && !SITE_KIT_RE.test(clean)))
			return [];
		const hit = hazards_cache.get(clean);
		if (hit) return hit;
		const src = read_source(clean);
		const at_src = clean.lastIndexOf('/src/');
		const kit = SITE_KIT_RE.test(clean);
		const file = kit
			? `ogygia/${clean.slice(clean.lastIndexOf('/content/') + 1)}`
			: at_src !== -1
				? clean.slice(at_src + 1)
				: clean.split('/').slice(-2).join('/');
		const out =
			src === null
				? []
				: hydration_hazards(src)
						.slice(0, 3)
						.map((h) => ({ file, ...h }));
		hazards_cache.set(clean, out);
		return out;
	};
	// WAKE ADVISOR FACTS: what the island's own `.svelte` sources do — handlers, `$state`,
	// `$effect`, `bind:`, `use:` — counted once per file, unioned over the closure. A regex count
	// on purpose: it needs no parse, it survives every syntax the transform accepts, and an island
	// with zero of everything is the one fact that matters (a lake wearing an island's wake).
	const facts_cache = new Map<string, IslandInteractivityFacts | null>();
	const facts_of = (id: string): IslandInteractivityFacts | null => {
		if (!read_source) return null;
		const clean = norm(id.split('?')[0]);
		if (!clean.endsWith('.svelte') || OWN_OR_DEP_RE.test(clean)) return null;
		const hit = facts_cache.get(clean);
		if (hit !== undefined) return hit;
		const src = read_source(clean);
		const f = src === null ? null : interactivity_facts(src);
		facts_cache.set(clean, f);
		return f;
	};
	const norm = (p: string) => p.split('\\').join('/');
	const readers = new Set(page_reader_files.map(norm));
	// The keys every module of a chunk reads, unioned; `undefined` = no module in it reads the page.
	const keys_in = (fileName: string): PageKeys | null | undefined => {
		if (!page_keys_of) return undefined;
		let acc: PageKeys | null = null;
		let any = false;
		for (const id of bundle[fileName]?.moduleIds ?? []) {
			const k = page_keys_of(norm(id.split('?')[0]));
			if (k === null) continue;
			any = true;
			acc = merge_page_keys(acc, k);
			if (acc === 'all') break;
		}
		return any ? acc : undefined;
	};
	const reads_page = (fileName: string): boolean => {
		if (!readers.size) return false;
		for (const id of bundle[fileName]?.moduleIds ?? []) {
			if (readers.has(norm(id.split('?')[0]))) return true;
		}
		return false;
	};
	const remotes_in = (fileName: string, acc: Set<string>): void => {
		if (!remote_hash) return;
		for (const id of bundle[fileName]?.moduleIds ?? []) {
			const h = remote_hash(id);
			if (h) acc.add(h);
		}
	};
	// Every EMITTED chunk reachable from `fileName` through static or dynamic imports (the facade
	// included) — the remotes scan's closure. Wider than the preload walk on purpose: a preload hint
	// for a dynamic chunk would be waste, a remote called from one is still this island's call.
	const closure_all = (fileName: string): Set<string> => {
		const seen = new Set<string>([fileName]);
		const queue = [fileName];
		while (queue.length) {
			const chunk = bundle[queue.pop()!];
			if (!chunk || chunk.type !== 'chunk') continue;
			for (const imp of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
				if (seen.has(imp)) continue;
				const dep = bundle[imp];
				if (!dep || dep.type !== 'chunk') continue;
				seen.add(imp);
				queue.push(imp);
			}
		}
		return seen;
	};

	const css_of = (fileName: string): string[] => {
		const chunk = bundle[fileName];
		const imported = chunk?.viteMetadata?.importedCss;
		if (!imported) return [];
		return [...imported].map((f) => (f.startsWith('/') ? f : `/${f}`));
	};

	const walk = (fileName: string, seen: Set<string>, css_acc: string[]): string[] => {
		const chunk = bundle[fileName];
		if (!chunk || chunk.type !== 'chunk') return [];
		const deps: string[] = [];
		for (const imp of chunk.imports ?? []) {
			if (seen.has(imp)) continue;
			seen.add(imp);
			// Only preload chunks that are actually EMITTED. Rolldown can list a phantom import in a
			// chunk's `imports` (a shared chunk that was merged/tree-shaken away before write) — the
			// real facade never imports it. Baking a modulepreload for a non-existent chunk 404s the
			// prerender. A missing preload only costs a waterfall, so skipping phantoms is safe.
			const dep = bundle[imp];
			if (!dep || dep.type !== 'chunk') continue;
			deps.push(imp.startsWith('/') ? imp : `/${imp}`);
			css_acc.push(...css_of(imp));
			deps.push(...walk(imp, seen, css_acc));
		}
		return deps;
	};

	// each island entry's identity (the key of every map), by its emitted file
	const identity_of = (fileName: string): string | null =>
		entries
			? (entries.islands.get(fileName) ?? null)
			: ISLAND_FACADE_RE.test(fileName)
				? fileName.startsWith('/')
					? fileName
					: `/${fileName}`
				: null;
	for (const [key, chunk] of Object.entries(bundle)) {
		if (chunk.type !== 'chunk') continue;
		const fileName = chunk.fileName || key;
		const entryUrl = identity_of(fileName);
		if (!entryUrl) continue;
		const seen = new Set<string>([fileName]);
		// CSS: the facade's own styles + every dep chunk's — this is how a server-picked (held)
		// component's scoped CSS reaches a page that never imported it (the page's stylesheet set
		// can't know; the region response carries these hrefs instead).
		const css_acc = css_of(fileName);
		const raw = walk(fileName, seen, css_acc);
		const uniq: string[] = [];
		const have = new Set<string>([entryUrl, `/${fileName.replace(LEADING_SLASH, '')}`]);
		for (const d of raw) {
			if (have.has(d)) continue;
			have.add(d);
			uniq.push(d);
		}
		js[entryUrl] = uniq;
		css[entryUrl] = [...new Set(css_acc)];
		// The FULL closure — static AND dynamic imports. A `page.data` read (or a remote call) behind
		// an `await import('./Widget.svelte')` inside island markup runs in the island's own client,
		// against the island's page shim, so it is the island's read — the same reasoning the remotes
		// scan (below) already applies. The static preload walk (`seen`, for `js`/`css`) deliberately
		// stops at dynamic edges — a modulepreload for a conditional chunk is waste — but PAGE READING
		// and SEEDING must not: a key the dynamic branch reads yet the seed omitted is `undefined` on
		// the client, the branch renders a different tree, and the island discards its server DOM
		// (a header search bar that `await import`s a signed-in widget vanished for logged-in users —
		// the widget read `page.data.locale`, which a static-only walk never pinned into the seed).
		const full = closure_all(fileName);
		// Does any chunk in the full closure bundle a page-reading shim?
		let reads = false;
		for (const s of full) {
			if (reads_page(s)) {
				reads = true;
				break;
			}
		}
		page[entryUrl] = reads;
		// SEED SHAPING: which `page.data` keys the full closure reads. A reader whose keys no module
		// recorded (the page reached through a module the transform never saw) ships all.
		if (reads) {
			let acc: PageKeys | null = null;
			let saw_reader = false;
			for (const s of full) {
				const k = keys_in(s);
				if (k === undefined) continue;
				saw_reader = true;
				acc = merge_page_keys(acc, k);
				if (acc === 'all') break;
			}
			page_keys[entryUrl] = !saw_reader || acc === 'all' || acc === null ? null : [...acc].sort();
		}
		// The remotes this island's client code can call: every remote module bundled anywhere in
		// its closure (static + dynamic). Sorted so the handoff is byte-stable across builds.
		const found = new Set<string>();
		for (const s of full) remotes_in(s, found);
		remotes[entryUrl] = [...found].sort();
		// the island's own components, over the same closure
		if (read_source) {
			let acc: IslandInteractivityFacts | undefined;
			const seen_files = new Set<string>();
			const lines: IslandHazard[] = [];
			for (const s of full) {
				for (const id of bundle[s]?.moduleIds ?? []) {
					const clean = norm(id.split('?')[0]);
					if (seen_files.has(clean)) continue;
					seen_files.add(clean);
					const f = facts_of(id);
					if (f) acc = merge_facts(acc, f);
					if (lines.length < 5) for (const h of hazards_of(id)) if (lines.length < 5) lines.push(h);
				}
			}
			if (lines.length) hazards[entryUrl] = lines;
			// (a remote function it calls — a streaming query, a form, a command — changes it after it
			// wakes with no handler of its own: a live clock, a remote form spread onto <form>)
			if (acc) interactivity[entryUrl] = { ...acc, remotes: remotes[entryUrl].length };
		}
	}
	// THE RUNTIME's own static imports, keyed by its URL like an island's: the few chunks it shares
	// with the rest of the app (Vite's preload helper, the modules Kit's client transport also uses).
	// SSR hints them beside the runtime script (document-tail.ts `runtime_bootstrap_tags`) so they
	// download with it, not one round trip after it is parsed.
	if (runtime_file) {
		const runtime_key = norm(runtime_file).replace(LEADING_SLASH, '');
		const chunk = bundle[runtime_key];
		if (chunk && chunk.type === 'chunk') {
			// (keyed by the runtime's identity, like an island's)
			js[entries?.runtime ?? `/${runtime_key}`] = [
				...new Set(walk(runtime_key, new Set([runtime_key]), []))
			];
		}
	}
	// WHAT IS INSIDE each chunk an island pulls (the profiler's Islands table): the bundler names
	// shared chunks by hash, so the handoff keeps a readable summary of each one's source modules.
	const contents: Record<string, string[]> = {};
	const heavy: Record<string, ChunkHeavy> = {};
	const summarize = (s: string) => {
		const url = s.startsWith('/') ? s : `/${s}`;
		if (contents[url]) return;
		const chunk = bundle[s];
		const ids = chunk?.moduleIds ?? [];
		// (the bundler's rendered length per module: the heaviest named first)
		const mods = (chunk as { modules?: Record<string, { renderedLength?: number }> } | undefined)
			?.modules;
		const size_of = mods ? (id: string) => mods[id]?.renderedLength ?? 0 : undefined;
		if (ids.length) contents[url] = summarize_chunk_contents(ids, 6, 5, size_of);
		if (ids.length && size_of) {
			const named = chunk_module_bytes(ids, size_of);
			if (named.top.length) heavy[url] = named;
		}
	};
	for (const [key, chunk] of Object.entries(bundle)) {
		if (chunk.type !== 'chunk') continue;
		const fileName = chunk.fileName || key;
		if (!identity_of(fileName)) continue;
		for (const s of closure_all(fileName)) summarize(s);
	}
	// …and every other chunk the build emitted (Kit's entries, ogygia's own dynamic runtime
	// chunks): the browser CPU profile sees them all, and a chunk it cannot name reads as app code
	for (const [key, chunk] of Object.entries(bundle)) {
		if (chunk.type === 'chunk') summarize(chunk.fileName || key);
	}
	// ONE MODULE, TWO COPIES: a package file reached by two paths (its source and its build, two
	// versions) lands in two chunks — a page loading both downloads it twice (the profiler says so)
	const dupes = duplicate_modules(
		Object.entries(bundle)
			.filter(([, c]) => c.type === 'chunk')
			.map(([key, c]) => {
				const mods = (c as { modules?: Record<string, { renderedLength?: number }> }).modules;
				return {
					file: c.fileName || key,
					ids: c.moduleIds ?? [],
					...(mods ? { size_of: (id: string) => mods[id]?.renderedLength ?? 0 } : {})
				};
			})
	);
	return { js, css, page, page_keys, remotes, interactivity, hazards, contents, heavy, dupes };
}

/** One module the build shipped as two (or more) copies: the same file of a package reached by two
 *  paths (its source and its build, two versions in node_modules), each copy in its chunk. */
export interface DuplicateModule {
	/** the module, package-relative (`ogygia/runtime/beacon`, `svelte/internal/client/index`) */
	name: string;
	/** `from`: where the copy came from — the package's folder (`ogygia/src`, `ogygia/dist`) or its
	 *  installed version (`svelte@5.56.8`) — the two paths, told apart */
	copies: { file: string; bytes: number; from?: string }[];
}

/** Where a module id's copy came from: an installed package's version (`name@1.2.3`, from a pnpm
 *  store path), else the package's top folder (`name/src`, `name/dist`). */
export function module_origin(id: string): string | undefined {
	const p = id.split('\\').join('/');
	const store = p.lastIndexOf('/.pnpm/');
	if (store !== -1) {
		const seg = p.slice(store + 7, p.indexOf('/', store + 7));
		// `svelte@5.56.8_…peer suffix` or `@scope+name@1.0.0`: the name and version, peers left out
		const cut = seg.indexOf('_');
		return (cut === -1 ? seg : seg.slice(0, cut)).split('+').join('/');
	}
	const key = module_key(id);
	if (!key) return undefined;
	// (the deepest such folder: a package inside an app's own src/ is the package's dist/, not the app's src)
	let at = -1;
	let top = '';
	for (const t of ['/src/', '/dist/', '/esm/', '/build/']) {
		const i = p.lastIndexOf(t);
		if (i > at) {
			at = i;
			top = t;
		}
	}
	return at === -1
		? undefined
		: `${p.slice(p.lastIndexOf('/', at - 1) + 1, at)}${top.slice(0, -1)}`;
}

/** A module id as the file of its package, the build-or-source folder and the extension left out:
 *  two ids with one key are one module twice. Null for ids that are no file (virtual, `\0`). */
export function module_key(id: string): string | null {
	if (!id || id.startsWith('\0') || is_generated_specifier(id)) return null;
	let p = id.split('\\').join('/');
	const q = p.indexOf('?');
	if (q !== -1) p = p.slice(0, q);
	let pkg: string;
	let rest: string;
	const nm = p.lastIndexOf('/node_modules/');
	if (nm !== -1) {
		const after = p.slice(nm + 14).split('/');
		const n = after[0].startsWith('@') ? 2 : 1;
		pkg = after.slice(0, n).join('/');
		rest = after.slice(n).join('/');
	} else {
		// a workspace package (linked, no node_modules in its path): the folder above its src/dist
		const at = Math.max(p.lastIndexOf('/src/'), p.lastIndexOf('/dist/'));
		if (at === -1) return null;
		pkg = p.slice(p.lastIndexOf('/', at - 1) + 1, at);
		rest = p.slice(at + 1);
	}
	for (const top of ['src/', 'dist/', 'esm/', 'build/'])
		if (rest.startsWith(top)) rest = rest.slice(top.length);
	for (const ext of ['.mjs', '.cjs', '.mts', '.ts', '.js'])
		if (rest.endsWith(ext)) rest = rest.slice(0, -ext.length);
	return pkg && rest ? `${pkg}/${rest}` : null;
}

/** Every module the build shipped more than once: one key, two or more ids (a single id is in one
 *  chunk only). The heaviest first, copies of 512 bytes or more, at most 50.
 *  @internal exported for the tests */
export function duplicate_modules(
	chunks: readonly { file: string; ids: readonly string[]; size_of?: (id: string) => number }[]
): DuplicateModule[] {
	const by = new Map<string, Map<string, { file: string; bytes: number }>>();
	for (const c of chunks)
		for (const id of c.ids) {
			const key = module_key(id);
			if (!key) continue;
			const ids = by.get(key) ?? by.set(key, new Map()).get(key)!;
			if (!ids.has(id)) {
				const from = module_origin(id);
				ids.set(id, {
					file: c.file.startsWith('/') ? c.file : `/${c.file}`,
					bytes: c.size_of?.(id) ?? 0,
					...(from ? { from } : {})
				});
			}
		}
	const out: DuplicateModule[] = [];
	for (const [name, ids] of by) {
		if (ids.size < 2) continue;
		const copies = [...ids.values()].filter((c) => c.bytes >= 512);
		if (copies.length >= 2) out.push({ name, copies });
	}
	const weight = (d: DuplicateModule) => d.copies.reduce((s, c) => s + c.bytes, 0);
	return out.sort((a, b) => weight(b) - weight(a)).slice(0, 50);
}

/** A chunk's rendered size and its heaviest named modules. */
export interface ChunkHeavy {
	/** every module's rendered bytes in the chunk */
	total: number;
	/** the five heaviest, by the names `contents` uses (a package's modules summed) */
	top: { name: string; bytes: number }[];
}

/** A chunk's modules as readable names (the same names `contents` uses) with their rendered bytes,
 *  heaviest first, the five heaviest; a package's modules summed under its name.
 *  @internal exported for the tests */
export function chunk_module_bytes(
	module_ids: readonly string[],
	size_of: (id: string) => number
): ChunkHeavy {
	const by = new Map<string, number>();
	let total = 0;
	for (const raw of module_ids) {
		if (!raw || raw.startsWith('\0') || is_generated_specifier(raw)) continue;
		const name = summarize_chunk_contents([raw], 1, 1)[0];
		if (!name) continue;
		const bytes = size_of(raw) || 0;
		total += bytes;
		by.set(name, (by.get(name) ?? 0) + bytes);
	}
	const top = [...by]
		.filter(([, bytes]) => bytes > 0)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, bytes]) => ({ name, bytes }));
	return { total, top };
}

const PKG_IN_PATH_RE = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/;
const SRC_IN_PATH_RE = /\/src\/(.+)$/;
/**
 * A chunk's source modules as a short readable list: the app's own files first (relative to
 * `src/`), then the packages, the framework runtimes named plainly. Capped; the tail is "+N more".
 * @internal exported for the tests
 */
export function summarize_chunk_contents(
	module_ids: readonly string[],
	max_files = 6,
	max_pkgs = 5,
	size_of?: (id: string) => number
): string[] {
	const files: string[] = [];
	const pkgs: string[] = [];
	// the rendered bytes behind each listed name (a package sums its modules): with the bundler's
	// sizes, the heaviest are named first — a 68 KB component used to sit behind "+N more" when six
	// small files came before it in module order. Names only: the list is a chunk's identity
	// across builds (sizes change every build).
	const bytes = new Map<string, number>();
	const add = (list: string[], v: string, raw: string) => {
		if (!list.includes(v)) list.push(v);
		if (size_of) bytes.set(v, (bytes.get(v) ?? 0) + (size_of(raw) || 0));
	};
	const ordered = (list: string[]) =>
		size_of ? [...list].sort((a, b) => (bytes.get(b) ?? 0) - (bytes.get(a) ?? 0)) : list;
	for (const raw of module_ids) {
		if (!raw || raw.startsWith('\0') || is_generated_specifier(raw)) continue;
		const id = raw.split('\\').join('/').split('?')[0];
		// the package is named by the LAST node_modules segment (pnpm nests: .pnpm/x@1/node_modules/x)
		const nm = id.lastIndexOf('/node_modules/');
		if (nm !== -1) {
			const pkg = PKG_IN_PATH_RE.exec(id.slice(nm))?.[1];
			if (pkg === 'svelte') add(pkgs, 'svelte runtime', raw);
			else if (pkg && OWN_PACKAGE_NAMES.includes(pkg)) add(pkgs, 'ogygia runtime', raw);
			else if (pkg) add(pkgs, pkg, raw);
			continue;
		}
		if (OWN_FILE_RE.test(id)) add(pkgs, 'ogygia runtime', raw);
		else {
			const rel = SRC_IN_PATH_RE.exec(id);
			add(files, rel ? `src/${rel[1]}` : id.split('/').slice(-2).join('/'), raw);
		}
	}
	const out = [...ordered(files).slice(0, max_files), ...ordered(pkgs).slice(0, max_pkgs)];
	const more =
		files.length -
		Math.min(files.length, max_files) +
		(pkgs.length - Math.min(pkgs.length, max_pkgs));
	if (more > 0) out.push(`+${more} more`);
	return out;
}

/** What an island's components do (the wake advisor's evidence) — see `interactivity_facts`. */
export interface IslandInteractivityFacts {
	handlers: number;
	state: number;
	effects: number;
	binds: number;
	actions: number;
	/** remote modules its closure can call (set per island from the remotes scan) */
	remotes?: number;
	/** `{await …}` / `{#await …}` in its markup: a value that lands after it wakes */
	awaits?: number;
	/** context reads and rune-module imports: state another island can change */
	shared?: number;
	files: number;
}

const OWN_OR_DEP_RE = new RegExp(`/node_modules/|${OWN_FILE_RE.source}`);
/** the site kit's components (ogygia's content/site): an app's own islands in all but location */
const SITE_KIT_RE = /\/ogygia\/(?:src|dist)\/content\//;
const HANDLER_RE = /\son[a-z]+\s*=\s*\{|\son:[a-z]+/g;
const STATE_RE = /\$state(?:\.raw)?\s*\(/g;
const EFFECT_RE = /\$effect(?:\.pre)?\s*\(/g;
const BIND_RE = /\sbind:[a-zA-Z]/g;
const ACTION_RE = /\suse:[a-zA-Z]/g;
const AWAIT_RE = /\{\s*(?:#\s*)?await\s/g;
// shared state another island can change: a context read, or an import of a rune module
// (`*.svelte.js` / `*.svelte.ts` — where shared `$state` lives). Conservative on purpose: "make it a
// lake" on an island showing another island's live counter would freeze it
// oxlint-disable-next-line ogygia/one-markup-walk -- `<[^>]*>` is a TypeScript type argument (`getContext<T>(`), not a tag
const SHARED_RE = /\bgetContext\s*(?:<[^>]*>\s*)?\(|\bfrom\s*['"][^'"]+\.svelte\.(?:js|ts)['"]/g;
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

/** Count a component source's interactivity markers. */
export function interactivity_facts(src: string): IslandInteractivityFacts {
	return {
		handlers: count(src, HANDLER_RE),
		state: count(src, STATE_RE),
		effects: count(src, EFFECT_RE),
		binds: count(src, BIND_RE),
		actions: count(src, ACTION_RE),
		awaits: count(src, AWAIT_RE),
		shared: count(src, SHARED_RE),
		files: 1
	};
}

function merge_facts(
	a: IslandInteractivityFacts | undefined,
	b: IslandInteractivityFacts
): IslandInteractivityFacts {
	if (!a) return { ...b };
	return {
		handlers: a.handlers + b.handlers,
		state: a.state + b.state,
		effects: a.effects + b.effects,
		binds: a.binds + b.binds,
		actions: a.actions + b.actions,
		awaits: (a.awaits ?? 0) + (b.awaits ?? 0),
		shared: (a.shared ?? 0) + (b.shared ?? 0),
		files: a.files + b.files
	};
}

/** Stable handoff path under Kit's `outDir`: client `generateBundle` writes; SSR reads at render
 *  (Kit is SSR-first). */
export function islandDepsHandoffPath(out_dir: string): string {
	return path.join(out_dir, 'og-region-deps.json');
}

/**
 * `ogygia:server/region-deps` emitter — the SSR-render-time reader of the deps handoff.
 * Client: unused (modulepreload is SSR HTML). SSR: read the handoff JSON at *render* time — Kit
 * builds the server bundle before the client, so baking at `load()` would always be empty;
 * prerender/live SSR run after client generateBundle. Resolve via import.meta.url walk (not absolute
 * build-machine paths) so adapters find `output/server/og-region-deps.json` next to the server bundle.
 * `out_dir_rel` — Kit's `outDir` relative to the app root (`.svelte-kit` by default) — is the cwd
 * fallback for adapter-node / preview run from the app root.
 */
/** A CSS text that would close its own `<style>` cannot be inlined — link it instead. */
const STYLE_CLOSE_RE = /<\/style/i;

/**
 * INLINE REGION CSS. For every region CSS asset (`hrefs`: the union of the handoff's `css` and
 * `content_css` lists) whose bytes are under `threshold` — Kit's `inlineStyleThreshold`, the same
 * number Kit inlines its own route sheets under — keep the asset's text, keyed by its public href.
 * The render then emits `<style data-ogygia-region-css="href">` in place of a blocking `<link>`:
 * a page carrying twenty-five small island sheets (42 KB on a measured home page, twenty of them
 * under 3 KB) stops paying twenty-five requests before first paint. `0` = keep nothing (Kit's
 * default: never inline). Above the threshold, or not an emitted asset, → not in the map → linked.
 *
 * @internal Exported for unit tests.
 */
export function collect_inline_css(
	bundle: Record<string, { type: string; fileName?: string; source?: string | Uint8Array }>,
	hrefs: Iterable<string>,
	threshold: number
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!(threshold > 0)) return out;
	const by_href = new Map<string, { type: string; source?: string | Uint8Array }>();
	for (const key in bundle) {
		const item = bundle[key];
		if (item.type !== 'asset') continue;
		const file = item.fileName || key;
		by_href.set(file.startsWith('/') ? file : `/${file}`, item);
	}
	for (const href of hrefs) {
		if (href in out) continue;
		const asset = by_href.get(href);
		if (!asset || asset.source == null) continue;
		const text =
			typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source);
		// Kit's unit: UTF-16 code units (`String.length`), "smaller than this value" — same rule.
		if (text.length >= threshold) continue;
		if (STYLE_CLOSE_RE.test(text)) continue;
		out[href] = text;
	}
	return out;
}

export function island_deps_module(
	ssr: boolean,
	is_dev: boolean,
	out_dir_rel = '.svelte-kit'
): string {
	// CLIENT: nothing to read (the SSR HTML carries every hint): each reader answers "none".
	if (!ssr)
		return dedent`
			export function region_deps(_entry) { return []; }
			export function region_css(_entry) { return []; }
			export function region_css_inline(_href) { return null; }
			export function content_css(_id) { return []; }
			export function region_reads_page(_entry) { return false; }
			export function region_page_keys(_entry) { return null; }
			export function region_page_why(_entry) { return null; }
			export function region_remotes(_entry) { return null; }
			export function region_interactivity(_entry) { return null; }
			export function region_hazards(_entry) { return null; }
			export function chunk_contents(_href) { return null; }
			export function chunk_heavy(_href) { return null; }
			export function chunk_barrels(_href) { return null; }
			export function chunk_duplicates() { return null; }
			export function fn_manifest() { return null; }
			export function entry_location(_identity) { return null; }
			export function location_map() { return null; }
			export function handoff_problem() { return null; }
		`;
	// DEV: there is no built CSS asset to link (Vite serves component CSS only as importable
	// modules). The `entry` a region carries IS its dev module URL (moduleUrl / dev island_url),
	// so returning it lets the client `import()` it for its CSS side-effect — the same region-css
	// channel as prod's `<link>`, resolved for dev. `islandDeps` (JS modulepreload) is prod-only.
	// Content bodies need no dev entry here: a content module is in the SSR module graph, so
	// Vite dev already injects its scoped CSS (the leak only bites the PROD client build).
	// DEV always seeds the page (no chunk closure to consult) — the conservative side. Same for the
	// remotes: `null` = "may call anything" (fail-open). A dev identity is its own location: the dev
	// server serves the module at the URL the region names.
	if (is_dev)
		return dedent`
			export function region_deps(_entry) { return []; }
			export function region_css(entry) { return entry ? [entry] : []; }
			export function region_css_inline(_href) { return null; }
			export function content_css(_id) { return []; }
			export function region_reads_page(_entry) { return true; }
			export function region_page_keys(_entry) { return null; }
			export function region_page_why(_entry) { return null; }
			export function region_remotes(_entry) { return null; }
			export function region_interactivity(_entry) { return null; }
			export function region_hazards(_entry) { return null; }
			export function chunk_contents(_href) { return null; }
			export function chunk_heavy(_href) { return null; }
			export function chunk_barrels(_href) { return null; }
			export function chunk_duplicates() { return null; }
			export function fn_manifest() { return null; }
			export function entry_location(identity) { return identity || null; }
			export function location_map() { return null; }
			export function handoff_problem() { return null; }
		`;
	// SERVER: read the handoff at render time (the comments below ride along into the module).
	const out_dir = JSON.stringify(out_dir_rel);
	return dedent`
		import fs from 'node:fs';
		import path from 'node:path';
		import { fileURLToPath } from 'node:url';

		// PRIMARY source: a string slot the client build patches in place with the manifest JSON (see
		// writeBundle). Inlined into the server bundle, it survives serverless tracing: Vercel/Netlify
		// (@vercel/nft) bundle only imported files, not runtime fs reads, so the co-located JSON below
		// is dropped there. The fs walk stays the fallback for adapter-node and dev-preview (the whole
		// server dir ships). Unpatched, the token starts with '_' (char 95), the guard is false, and
		// the walk runs. A bad patch degrades to the walk, never crashes the server at import.
		const __OG_INLINE = '${ISLAND_DEPS_INLINE_TOKEN}';
		let cache = null;
		// Why the last read found no handoff (null: it has one). The server says it once, with a
		// code (island_deps_handoff_missing). A read that failed is never kept: the next one tries
		// again. Every path absent is the deployment's fact, kept with its problem.
		let problem = null;
		let absent = false;
		let inline_error = null;
		if (__OG_INLINE.charCodeAt(0) === 123) {
			try {
				cache = JSON.parse(__OG_INLINE);
			} catch (e) {
				inline_error = '(inlined in the server bundle): ' + String(e);
			}
		}

		function candidates() {
			const out = [];
			try {
				let dir = path.dirname(fileURLToPath(import.meta.url));
				for (let i = 0; i < 8; i++) {
					out.push(path.join(dir, 'og-region-deps.json'));
					const parent = path.dirname(dir);
					if (parent === dir) break;
					dir = parent;
				}
			} catch {}
			if (typeof process !== 'undefined' && process.cwd) {
				const cwd = process.cwd();
				out.push(path.join(cwd, ${out_dir}, 'og-region-deps.json'));
				out.push(path.join(cwd, ${out_dir}, 'output', 'server', 'og-region-deps.json'));
			}
			return out;
		}

		const NONE = {};
		function load() {
			if (cache) return cache;
			if (absent) return NONE;
			const tried = [];
			let error = inline_error;
			for (const p of candidates()) {
				tried.push(p);
				let text;
				try {
					text = fs.readFileSync(p, 'utf8');
				} catch (e) {
					// (absent here: the next candidate)
					if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) error = error || p + ': ' + String(e);
					continue;
				}
				try {
					cache = JSON.parse(text);
					problem = null;
					return cache;
				} catch (e) {
					error = error || p + ': ' + String(e);
				}
			}
			problem = error ? { kind: 'unreadable', tried, error } : { kind: 'missing', tried };
			absent = !error;
			return NONE;
		}

		/** Why the server has no handoff (\`missing\`: no path held one; \`unreadable\`: one failed to
		 *  read or parse), or null when it has one. */
		export function handoff_problem() {
			load();
			return problem;
		}

		// Handoff shape: { js: { entryUrl: [...] }, css: { entryUrl: [...] } }. A stale flat
		// map (pre-css build) degrades gracefully: js falls back to the root, css to [].
		function pick(kind, entry) {
			const all = load();
			const map = all && typeof all[kind] === 'object' ? all[kind] : kind === 'js' ? all : null;
			const list = map ? map[entry] : null;
			return Array.isArray(list) ? list : [];
		}

		/** One entry of a handoff map (\`field\`), or null: no map, no key, or the wrong shape. */
		function lookup(field, key, ok) {
			const all = load();
			const map = all && typeof all[field] === 'object' && all[field] ? all[field] : null;
			if (!map || !key) return null;
			const v = map[key];
			return ok(v) ? v : null;
		}

		/** A chunk href's key: root-absolute, as the build wrote it. */
		function chunk_key(href) {
			return href.startsWith('/') ? href : '/' + href.replace(/^\\.\\//, '');
		}

		export function region_deps(entry) {
			return entry ? pick('js', entry) : [];
		}

		export function region_css(entry) {
			return entry ? pick('css', entry) : [];
		}

		// INLINE REGION CSS: the text of a region CSS asset the build kept under Kit's
		// inlineStyleThreshold (collect_inline_css), keyed by the same public href islandCss hands
		// out. null = link it (over the threshold, no threshold, or a pre-inline handoff).
		export function region_css_inline(href) {
			return lookup('css_inline', href, (v) => typeof v === 'string');
		}

		export function content_css(id) {
			return id ? pick('content_css', id) : [];
		}

		// Does this island's client closure read $page? FAIL-OPEN: no map (a pre-page handoff), or an
		// entry the build never saw (a foreign fragment's island mounted from another app) → true, so
		// the seed ships and nothing that might read it finds it missing.
		export function region_reads_page(entry) {
			const all = load();
			const map = all && typeof all.page === 'object' && all.page ? all.page : null;
			if (!map || !entry) return true;
			const v = map[entry];
			return v === undefined ? true : !!v;
		}

		// SEED SHAPING: which top-level page.data keys this island's closure reads. FAIL-OPEN as null
		// ("ship all"): no map (a pre-shaping handoff), an entry the build never saw, or a closure
		// whose reads could not be pinned to literal keys.
		export function region_page_keys(entry) {
			return lookup('page_keys', entry, Array.isArray);
		}

		// Why this island ships all of page.data: the modules in its closure whose reads the build
		// could not pin (file, line, why). Profiler builds only; null = none recorded.
		export function region_page_why(entry) {
			return lookup('page_why', entry, Array.isArray);
		}

		// Which remotes (Kit id-hashes) this island's client closure can call: REMOTE SEED ONLY WHEN
		// REACHABLE. FAIL-OPEN as null ("may call anything"): no map (a pre-remotes handoff), or an
		// entry the build never saw (a foreign fragment's island) → every SSR-resolved remote seeds.
		export function region_remotes(entry) {
			return lookup('remotes', entry, Array.isArray);
		}

		// WAKE ADVISOR facts per entry (handlers / $state / bind: counts over the island's own
		// components), for the profiler's Islands table. null = the handoff has none.
		export function region_interactivity(entry) {
			return lookup('interactivity', entry, (v) => !!v && typeof v === 'object');
		}

		// each island's lines that draw differently in the browser (the profiler's mismatch findings)
		export function region_hazards(entry) {
			return lookup('hazards', entry, Array.isArray);
		}

		// WHAT IS INSIDE a chunk (readable source list): the profiler names hashed chunks with it
		export function chunk_contents(href) {
			const all = load();
			const map = all && typeof all.contents === 'object' && all.contents ? all.contents : null;
			if (!map || !href) return null;
			const v = map[chunk_key(href)] ?? map[href];
			return Array.isArray(v) ? v : null;
		}

		// …and its heaviest modules with their rendered bytes (the report's heavy-module finding)
		export function chunk_heavy(href) {
			const all = load();
			const map = all && typeof all.heavy === 'object' && all.heavy ? all.heavy : null;
			if (!map || !href) return null;
			const v = map[chunk_key(href)] ?? map[href];
			return v && typeof v === 'object' && Array.isArray(v.top) ? v : null;
		}

		// …and the re-export barrels it still holds (the report's island-barrel note)
		export function chunk_barrels(href) {
			const all = load();
			const map = all && typeof all.barrels === 'object' && all.barrels ? all.barrels : null;
			if (!map || !href) return null;
			const v = map[chunk_key(href)] ?? map[href];
			return Array.isArray(v) ? v : null;
		}

		// the modules the build shipped twice, each copy's chunk (the report's duplicate-module finding)
		export function chunk_duplicates() {
			const all = load();
			const v = all && Array.isArray(all.dupes) ? all.dupes : null;
			return v && v.length ? v : null;
		}

		// og.$ factories for the page-inline registration script (CSP-clean prod path): written by
		// the CLIENT build's writeBundle, read here at SSR render time, the same ordering-safe channel
		// islandCss uses.
		export function fn_manifest() {
			const m = load().fn_manifest;
			return m && typeof m === 'object' && Object.keys(m).length ? m : null;
		}

		// IDENTITY → LOCATION: the content-hashed file an entry (an island's stable URL, the runtime's)
		// is served from. null = no location known (a handoff from before hashing, a foreign island):
		// the identity itself is written, and the browser finds it in the build's location maps.
		export function entry_location(identity) {
			const m = load().entries;
			const v = m && typeof m === 'object' && identity ? m[identity] : null;
			return typeof v === 'string' ? v : null;
		}

		// The build's content-hashed location map (link/location-map.ts), the file the browser reads:
		// its served path, base-less (asset() adds it), or null (no island, a handoff from before it).
		export function location_map() {
			const v = load().locations;
			return typeof v === 'string' ? v : null;
		}
	`;
}
