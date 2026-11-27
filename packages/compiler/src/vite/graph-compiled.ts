/** The part of a bundler's plugin context the wait reads (Rolldown's, Vite's build). */
export interface CompiledGraph {
	getModuleIds(): Iterable<string>;
	getModuleInfo(id: string): {
		code: string | null;
		importedIds: readonly string[];
		dynamicallyImportedIds: readonly string[];
	} | null;
	resolve(source: string): Promise<{ external?: unknown } | null>;
	load(options: { id: string; resolveDependencies: boolean }): Promise<unknown>;
}

/**
 * Resolves once the bundler has compiled every module of the bundle (loaded, transformed, its
 * imports resolved), dynamic imports and their imports included, but the ones `skip` names: the
 * modules that wait here themselves, which would otherwise wait on each other. Each loaded module's
 * own imports are walked from its module info, since the bundler lists a resolved import among
 * its module ids only later; rounds over the module ids catch what no walk reached, until a round
 * finds nothing new. An external module is never loaded.
 */
export async function graph_compiled(
	graph: CompiledGraph,
	skip: (id: string) => boolean
): Promise<void> {
	const seen = new Set<string>();
	const walk = async (id: string): Promise<void> => {
		if (seen.has(id) || skip(id)) return;
		seen.add(id);
		await compiled(graph, id);
		const info = graph.getModuleInfo(id);
		if (info === null) return;
		await Promise.all([...info.importedIds, ...info.dynamicallyImportedIds].map(walk));
	};
	for (;;) {
		const next = [...graph.getModuleIds()].filter((id) => !seen.has(id) && !skip(id));
		if (next.length === 0) return;
		await Promise.all(next.map(walk));
	}
}

async function compiled(graph: CompiledGraph, id: string): Promise<void> {
	// @why Rolldown's this.load never settles for an external module, and its module info cannot tell one from a module still loading (test: test/graph-compiled.test.ts › a waiting module loads after every other module has compiled: a dynamic import, its own imports, and an external among them (#2165))
	if (graph.getModuleInfo(id)?.code == null && (await graph.resolve(id))?.external) return;
	await graph.load({ id, resolveDependencies: true });
}
