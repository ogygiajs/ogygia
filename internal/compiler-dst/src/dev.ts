/**
 * A DEV SERVER, IN MEMORY. What the ogygia Vite plugin does on a file event, without Vite: the same
 * compiler calls in the same order (vite/index.ts `watchChange`, then `handleHotUpdate`, then the
 * transform hook), and Vite's own part played by a cache of served modules. Vite re-runs a plugin
 * transform or load only for a module someone invalidated (the edited file itself, or an id ogygia
 * named); every other module keeps the output it was first served with. So "dev matches a cold
 * start" is a real oracle: a module served stale in dev differs from a fresh session's.
 */
import path from 'node:path';
import { memory_fs, type MemoryFs } from '../../../packages/compiler/src/compiler/index.ts';
import { code_of, session, transform_module, type Leg, type Session } from './session.ts';
import { LIB, ROOT } from './app.ts';
import { permute } from './order.ts';

const LEGS: readonly Leg[] = ['ssr', 'client'];

/** The plugin's own patterns (vite/index.ts). */
const ROUTE_HOST_OR_OPTION_RE = /[\\/]\+(page|layout)(\.server)?\.(svelte|js|ts)$/;
const STYLE_BEARING_FILE_RE = /\.(svelte|css|scss|sass|less|styl)$/;

/** The table's single modules a page can import (virtual/core.ts), by specifier. Families (island
 *  entries) are served off the registry instead. */
export const VIRTUALS = [
	'ogygia:boot/runtime-entry',
	'ogygia:boot/runtime-flags',
	'ogygia:boot/hydrate-features',
	'ogygia:boot/fn-manifest',
	'ogygia:region/transportables',
	'ogygia:region/transportables-eager',
	'ogygia:region/kit-transport',
	'ogygia:server/route-csr',
	'ogygia:server/route-config',
	'ogygia:server/server-manifest',
	'ogygia:server/server-regions',
	'ogygia:server/region-deps'
] as const;

/**
 * FILED BUGS THE MODEL WORKS AROUND, so a search goes on past them. Each entry makes the model do
 * what the fix will make the plugin do; it leaves when the fix lands (and the oracle then proves the
 * fix the same way).
 * - #1375: a csr change re-transforms the route hosts (here: every route host is dropped as if
 *   edited).
 * - #1376: a transform that changed the registry or the marks reloads what read them.
 * - #1399: the server manifest's lines are compared sorted (`as_judged`).
 * - #1317: seed shaping misses a page passed as a parameter default (reads.ts `KNOWN_READS`).
 */
export const KNOWN: ReadonlySet<number> = new Set(
	(process.env.DST_KNOWN ?? '1317,1375,1376,1399').split(',').filter(Boolean).map(Number)
);

/** A served module as the oracles compare it. #1399 (the server manifest in registration order):
 *  its lines sorted, until the fix lands. */
export function as_judged(id: string, out: Served): Served {
	if (KNOWN.has(1399) && typeof out === 'string' && id.includes('ogygia:server/server-'))
		return out
			.split('\n')
			.map((l) => l.replace(/,$/, ''))
			.sort()
			.join('\n');
	return out;
}

/** The registry and the marks, as text: what a `regions` reload depends on. */
const regions_print = (s: Session): string =>
	JSON.stringify([[...s.program.registry.keys()].sort(), s.program.runtime_marks]);

/** A module's source as served: its text, or why it has none. */
export type Served = string | null | { throws: string };

/** Where a page load starts: every component of the app (as if each page imported each one: a
 *  component no page imports is still prescanned in a cold start, so dev must have served it too
 *  for the two to compare) and each table module (the runtime and the server import them). */
export function entries(fs: MemoryFs): string[] {
	return [
		...fs
			.files()
			.filter((f) => f.startsWith(`${ROOT}/src/`) && f.endsWith('.svelte'))
			.sort(),
		...VIRTUALS.map((v) => `\0${v}`)
	];
}

/** A module's import specifiers: static, side-effect and dynamic imports. */
const IMPORT_RE =
	/\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?(['"])([^'"]+)\1|\bimport\(\s*(['"])([^'"]+)\3\s*\)/g;
export function import_specs(code: string): string[] {
	const out: string[] = [];
	for (const m of code.matchAll(IMPORT_RE)) out.push(m[2] ?? m[4]);
	return out;
}

/**
 * The served modules, by `<leg> <id>`, and the import edges each one's import analysis found.
 * `serve()` is a page load: from the entries, every module reached through its imports, served
 * through the plugin's hooks (resolveId, then load or the file, then transform) the first time it
 * is reached and from the cache after. `invalidate()` is Vite's `moduleGraph.invalidateModule`.
 */
export class Server {
	readonly cache = new Map<string, Served>();
	/** the keys the last page load reached (a module only an old page reached stays cached) */
	readonly reached = new Set<string>();
	readonly #edges = new Map<string, string[]>();

	/** What the last page load was served, by key. */
	served(): Map<string, Served> {
		return new Map([...this.reached].map((k) => [k, as_judged(k, this.cache.get(k) ?? null)]));
	}
	readonly s: Session;
	readonly fs: MemoryFs;
	/** a seeded order to request the entries in (a bundler's workers reach modules in any order) */
	readonly #next: (() => number) | null;
	constructor(s: Session, fs: MemoryFs, next: (() => number) | null = null) {
		this.s = s;
		this.fs = fs;
		this.#next = next;
	}

	invalidate(id: string): void {
		const bare = id.startsWith('\0') ? id.slice(1) : id;
		for (const leg of LEGS)
			for (const key of [`${leg} ${bare}`, `${leg} \0${bare}`]) {
				this.cache.delete(key);
				this.#edges.delete(key);
			}
	}

	/** One page load, repeated while ogygia invalidates what it just served (a closure mark, a stale
	 *  server manifest): bounded, since each round is a real reload. In a build, one leg's graph
	 *  (`legs`): the server leg, then the client leg. */
	async serve(legs: readonly Leg[] = LEGS): Promise<void> {
		for (let round = 0; round < 4; round++) {
			let did = false;
			this.reached.clear();
			for (const leg of legs) {
				const seen = new Set<string>();
				const queue = this.#next ? permute(entries(this.fs), this.#next) : entries(this.fs);
				while (queue.length) {
					const id = queue.shift()!;
					if (seen.has(id)) continue;
					seen.add(id);
					const key = `${leg} ${id}`;
					this.reached.add(key);
					if (!this.cache.has(key)) {
						did = true;
						await this.#serve_one(id, leg, key);
					}
					queue.push(...(this.#edges.get(key) ?? []));
				}
			}
			if (!did) return;
		}
	}

	async #serve_one(id: string, leg: Leg, key: string): Promise<void> {
		const { compiler } = this.s;
		const ssr = leg === 'ssr';
		const before = KNOWN.has(1376) ? regions_print(this.s) : '';
		let out: Served;
		const source = id.startsWith('/') ? this.fs.read(id) : await this.#load(id, leg);
		if (source === null || typeof source === 'object') out = source;
		else out = (await transform_module(this.s, id, leg, source)) ?? source;
		this.cache.set(key, out);
		if (KNOWN.has(1376) && regions_print(this.s) !== before)
			for (const mid of compiler.changed('regions')) this.invalidate(mid);
		if (this.s.ctx.is_dev) {
			if (compiler.server_manifest_stale())
				for (const mid of compiler.changed('regions')) this.invalidate(mid);
			for (const marked of compiler.drain_closure_marks()) this.invalidate(marked);
		}
		// import analysis: each import resolved through the plugin's resolveId, then Vite's own
		const edges: string[] = [];
		if (typeof out === 'string')
			for (const spec of import_specs(out)) {
				const r = await this.#resolve(spec, id, ssr);
				if (r) edges.push(r);
			}
		this.#edges.set(key, edges);
	}

	async #resolve(spec: string, importer: string, ssr: boolean): Promise<string | null> {
		let r: string | { id: string } | null;
		try {
			r = await this.s.compiler.resolve_id(spec, importer, {
				ssr,
				resolve: async (s, i) => {
					const id = this.#vite_resolve(s, i);
					return id ? { id } : null;
				}
			});
		} catch {
			return null; // ok: an import the plugin refuses fails that module's load, not the walk
		}
		const id = r === null ? this.#vite_resolve(spec, importer) : typeof r === 'string' ? r : r.id;
		if (!id) return null;
		// only the app's modules and ogygia's virtuals: the rest (Svelte, ogygia's runtime) is fixed
		if (id.startsWith(`${ROOT}/`) || id.startsWith('\0ogygia:') || this.s.program.registry.has(id))
			return id;
		return null;
	}

	/** Vite's resolver, for what the plugin left: the `$lib` alias, relative and absolute paths, a
	 *  dev URL of a virtual. */
	#vite_resolve(spec: string, importer: string): string | null {
		let s = spec.split('?')[0];
		if (s.startsWith('/@id/')) s = s.slice('/@id/'.length);
		if (this.s.program.registry.has(s)) return s;
		if (s.startsWith('$lib/')) s = `${LIB}/${s.slice('$lib/'.length)}`;
		else if (s.startsWith('.')) {
			if (!importer.startsWith('/')) return null;
			s = path.resolve(path.dirname(importer), s);
		}
		if (!s.startsWith('/')) return null;
		return this.fs.read(s) === null ? null : s;
	}

	async #load(id: string, leg: Leg): Promise<Served> {
		try {
			const out = await this.s.compiler.emit(id, { ssr: leg === 'ssr', universalHooks: null });
			return out === null ? null : typeof out === 'string' ? out : out.code;
		} catch (e) {
			return { throws: code_of(e) };
		}
	}
}

/** A dev server on `files`: started (Vite's `buildStart` prescans), nothing served yet. */
export function dev_server(files: Record<string, string>): Server {
	const fs = memory_fs(files);
	const s = session(fs, { dev: true });
	s.compiler.prescan();
	return new Server(s, fs);
}

/** A cold server on `files`, every module served once: what a restart would show. `widen`: a
 *  session whose grow-only facts (see {@link GROW_ONLY}) the cold one starts from. */
export async function cold_server(
	files: Record<string, string>,
	{ dev, widen }: { dev: boolean; widen?: Session }
): Promise<Server> {
	const fs = memory_fs(files);
	const s = session(fs, { dev });
	s.compiler.prescan();
	if (widen) {
		for (const f of widen.program.island_graph) s.program.island_graph.add(f);
		const marks = s.program.runtime_marks as Record<string, unknown>;
		for (const [k, v] of Object.entries(widen.program.runtime_marks)) {
			const mine = marks[k];
			if (k === 'complete') marks[k] = mine !== false && v !== false;
			else if (Array.isArray(v)) marks[k] = [...new Set([...((mine as string[]) ?? []), ...v])];
			else if (v === true) marks[k] = true;
		}
	}
	const server = new Server(s, fs);
	await server.serve();
	return server;
}

/**
 * GROW-ONLY FACTS. A dev session only ever adds to these: a mark a deleted region set stays, and a
 * module that stopped being in an island's closure stays in the island graph. Both are safe that way
 * (a feature too many ships code no page runs; the `$app/*` shims answer on any document), so the
 * oracle allows dev a superset here, and nothing else. The missing case is the bug: a feature or a
 * closure module the cold start has and dev lacks.
 */
export const GROW_ONLY = ['island_graph', 'runtime_marks'] as const;

/** What `cold` holds of the grow-only facts that `dev` lacks (empty: dev covers it). */
export function grow_only_missing(dev: Session, cold: Session): string[] {
	const out: string[] = [];
	for (const f of cold.program.island_graph)
		if (!dev.program.island_graph.has(f)) out.push(`island_graph ${f}`);
	const d = dev.program.runtime_marks as Record<string, unknown>;
	for (const [k, v] of Object.entries(cold.program.runtime_marks)) {
		if (k === 'complete') {
			if (v === false && d[k] !== false) out.push('runtime_marks complete');
		} else if (Array.isArray(v)) {
			for (const x of v)
				if (!((d[k] as string[]) ?? []).includes(x)) out.push(`runtime_marks ${k} ${x}`);
		} else if (v === true && d[k] !== true) out.push(`runtime_marks ${k}`);
	}
	return out;
}

/**
 * One file event, as an editor saves it: `text` is the new content, `null` deletes the file. The
 * plugin's hooks run in Vite's order, then Vite drops the file's own module (its importers keep
 * theirs: Vite re-runs no plugin for them).
 */
export function edit(server: Server, file: string, text: string | null): void {
	const { compiler } = server.s;
	const existed = server.fs.read(file) !== null;
	if (text === null && !existed) return;
	server.fs.set(file, text);
	const event = text === null ? 'delete' : existed ? 'update' : 'create';
	const invalidate = (id: string) => server.invalidate(id);

	// watchChange
	if (ROUTE_HOST_OR_OPTION_RE.test(file)) {
		compiler.ctx.routes.clear();
		for (const mid of compiler.changed('routes')) invalidate(mid);
		if (KNOWN.has(1375))
			for (const host of server.fs.files())
				if (host !== file && ROUTE_HOST_OR_OPTION_RE.test(host) && host.endsWith('.svelte')) {
					if (compiler.is_registered_host(host)) compiler.invalidate_for_file(host, { invalidate });
					invalidate(host);
				}
	}
	if (event === 'delete') compiler.invalidate_for_file(file, { deleted: true, invalidate });

	// handleHotUpdate
	if (STYLE_BEARING_FILE_RE.test(file))
		for (const mid of compiler.changed('styles')) invalidate(mid);
	const deleted = server.fs.read(file) === null;
	if ((!deleted && compiler.is_registered_host(file)) || deleted)
		compiler.invalidate_for_file(file, { deleted, invalidate });

	// Vite: the file's own module
	invalidate(file);
}
