import path from 'node:path';

/** Structural shape of a Vite dev module-graph node (the two fields the owner walk reads). */
export type DevGraphModule = { file?: string | null; importers?: Iterable<DevGraphModule> };

/**
 * Which top-level route scopes can reach `abs_file` — walked UP the dev module graph until route
 * files are hit. A scope is a route file's first path segment under `src/routes` (`'(docs)'`,
 * `'playground'`, `''` for a root-level route file). `[]` = no route owner found; the client treats
 * that as shared and joins anywhere (the safe default for exotic graphs).
 *
 * @internal Exported for unit tests.
 */
export function derive_css_scope_owners(
	abs_file: string,
	routes_dir_of_app: string,
	graphs: Array<
		{ getModulesByFile?: (f: string) => Set<DevGraphModule> | undefined } | undefined | null
	>
): string[] {
	const routes_dir = routes_dir_of_app + path.sep;
	const owners = new Set<string>();
	const seen = new Set<DevGraphModule>();
	const stack: DevGraphModule[] = [];
	for (const g of graphs) {
		for (const m of g?.getModulesByFile?.(abs_file) ?? []) stack.push(m);
	}
	let steps = 0;
	while (stack.length && steps++ < 5000) {
		const mod = stack.pop()!;
		if (seen.has(mod)) continue;
		seen.add(mod);
		const f = mod.file ? path.normalize(mod.file) : null;
		if (f && f.startsWith(routes_dir)) {
			const seg = f.slice(routes_dir.length).split(path.sep)[0] ?? '';
			owners.add(seg.includes('.') ? '' : seg);
			continue;
		}
		for (const imp of mod.importers ?? []) stack.push(imp);
	}
	return [...owners].sort();
}
