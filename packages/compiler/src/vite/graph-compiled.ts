import { backoffAfter, clock, policy, scope, STALE, type Scope, type Stale } from '@ogygia/machine';

/** The part of a bundler's plugin context the wait reads (Rolldown's, Vite's build). */
export interface CompiledGraph {
	getModuleIds(): Iterable<string>;
	getModuleInfo(id: string): ModuleInfo | null;
	resolve(source: string, importer?: string): Promise<{ external?: unknown } | null>;
	load(options: { id: string; resolveDependencies: boolean }): Promise<unknown>;
}

interface ModuleInfo {
	code: string | null;
	importedIds: readonly string[];
	dynamicallyImportedIds: readonly string[];
}

const BEGUN = policy({ attempts: 1, backoff: [1, 2, 4, 8, 16, 32, 50], jitter: 0 });

/**
 * Resolves once the bundler has compiled every module of the bundle, dynamic imports and their
 * imports included, but the ones `skip` names (the modules that wait here themselves). It never
 * starts a module's load: it waits on a module only once the bundler has begun it, and stops
 * waiting for one after `quiet` ms in which no awaited module was begun.
 */
export async function graph_compiled(
	graph: CompiledGraph,
	skip: (id: string) => boolean,
	quiet = 30_000
): Promise<void> {
	const owner = scope();
	const begun = new BegunModules(graph, owner, quiet);
	const seen = new Set<string>();
	let named: ReadonlyMap<string, string> | null = null;
	const walk = async (id: string, importer: string | undefined): Promise<void> => {
		if (seen.has(id) || skip(id)) return;
		seen.add(id);
		const info = await begun.info_once_begun(id);
		if (info === STALE) return;
		if (info.code === null) {
			named ??= importer_of_each_import(graph);
			// @why Rolldown's module info is the same for an external and a module still loading, its this.load never settles for an external, and a resolveId may call an id external only for an importer (test: test/graph-compiled.test.ts › a waiting module builds with an external that resolveId marks only for an importer, once the bundler has listed it (#2167 re-resolved it with no importer and waited forever))
			if ((await graph.resolve(id, importer ?? named.get(id)))?.external) return;
			await graph.load({ id, resolveDependencies: true });
		}
		const done = graph.getModuleInfo(id);
		if (done === null) return;
		await Promise.all(
			[...done.importedIds, ...done.dynamicallyImportedIds].map((m) => walk(m, id))
		);
	};
	try {
		for (;;) {
			named = null;
			const next = [...graph.getModuleIds()].filter((id) => !seen.has(id) && !skip(id));
			if (next.length === 0) return;
			await Promise.all(next.map((id) => walk(id, undefined)));
		}
	} finally {
		owner.close();
	}
}

function importer_of_each_import(graph: CompiledGraph): ReadonlyMap<string, string> {
	const named = new Map<string, string>();
	for (const id of graph.getModuleIds()) {
		const info = graph.getModuleInfo(id);
		if (info === null) continue;
		for (const m of info.importedIds) if (!named.has(m)) named.set(m, id);
		for (const m of info.dynamicallyImportedIds) if (!named.has(m)) named.set(m, id);
	}
	return named;
}

class BegunModules {
	readonly #graph: CompiledGraph;
	readonly #owner: Scope;
	readonly #quiet: number;
	#waiting = 0;
	#moved = 0;

	constructor(graph: CompiledGraph, owner: Scope, quiet: number) {
		this.#graph = graph;
		this.#owner = owner;
		this.#quiet = quiet;
	}

	info_once_begun(id: string): Promise<ModuleInfo | Stale> {
		const now = this.#graph.getModuleInfo(id);
		if (now !== null) return Promise.resolve(now);
		// @why Rolldown lists an import only once its own load begins, after the importer's moduleParsed hooks, and has no hook at that moment (test: test/graph-compiled.test.ts › a waiting module waits for the imports of a module the bundler has parsed but whose imports it has not yet started (#2192: on CI the feature word read only main.js))
		if (this.#waiting++ === 0) this.#moved = clock.mono();
		return this.#owner.task(
			() =>
				new Promise<ModuleInfo | Stale>((settle) => {
					const check = (tries: number): void => {
						const info = this.#graph.getModuleInfo(id);
						if (info !== null) this.#moved = clock.mono();
						// @why a module whose moduleParsed hook throws names imports Rolldown never begins, and Rolldown ends the build only after this load hook settles (test: test/graph-compiled.test.ts › a waiting module settles when an importer fails in moduleParsed, so the build reports that failure)
						else if (clock.mono() - this.#moved < this.#quiet) {
							this.#owner.timeout(() => check(tries + 1), backoffAfter(BEGUN, tries));
							return;
						}
						this.#waiting--;
						settle(info ?? STALE);
					};
					check(1);
				})
		);
	}
}
