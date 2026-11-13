import type { ViteDevServer } from 'vite';
import type { PageReads } from './plugin-api.ts';

export const DEV_MAPS: unique symbol = Symbol.for('ogygia.profiler.dev-maps');
export const DEV_PAGE_KEYS: unique symbol = Symbol.for('ogygia.profiler.dev-page-keys');

/** what an island's code reads of `page.data`, as the build would say: its keys, or `'all'` with
 *  the lines that make it so; `null` when nothing in it reads the page */
export interface DevPageKeys {
	keys: string[] | 'all' | null;
	why: { file: string; line: number | null; why: string }[];
}

type SsrNode = { file?: string | null; id?: string | null; importedModules?: Set<SsrNode> };
type SsrGraph = { getModulesByFile(file: string): Set<SsrNode> | undefined };

/**
 * THE BUILD'S SEED ANSWER, ON THE DEV SERVER: the build pins which `page.data` keys each island's
 * code reads (seed shaping); the dev server does not — every island reads "everything" there, so
 * the profiler could not tell a late island's data or point at the line that ships it all. This
 * puts the same analysis behind a global the profiler (same process) asks: the island id's
 * component and the app modules it imports (the SSR graph, eight deep), read together by the
 * seed-shaping plugin (`PageReads.dev`), a helper handed the page followed like the build does.
 * Only what the report says changes: the dev seed itself still ships whole.
 */
export function install_dev_page_keys(
	server: ViteDevServer,
	component_of: (iid: string) => string | null | undefined,
	root: string,
	reads: PageReads
): void {
	const ssr = () =>
		(server as unknown as { environments?: Record<string, { moduleGraph?: SsrGraph }> })
			.environments?.ssr?.moduleGraph;
	const app_file = (f: string | null | undefined): f is string =>
		!!f && f.startsWith(root) && !f.includes('/node_modules/');
	(globalThis as Record<symbol, unknown>)[DEV_PAGE_KEYS] = async (
		iid: string
	): Promise<DevPageKeys | undefined> => {
		const component = component_of(iid)?.split('?')[0];
		const graph = ssr();
		if (!component || !graph) return undefined;
		const files: string[] = [];
		const seen = new Set<string>();
		let level: string[] = [component];
		for (let depth = 0; depth < 8 && level.length; depth++) {
			const next: string[] = [];
			for (const f of level) {
				if (seen.has(f)) continue;
				seen.add(f);
				files.push(f);
				for (const node of graph.getModulesByFile(f) ?? [])
					for (const dep of node.importedModules ?? []) {
						const df = dep.file?.split('?')[0];
						if (app_file(df) && !seen.has(df)) next.push(df);
					}
			}
			level = next;
		}
		const a = await reads.dev(files, async (specifier, importer) => {
			const resolved = await server.pluginContainer
				.resolveId(specifier, importer, { ssr: true })
				.catch(() => null); // ok: dev only: a helper that does not resolve is not followed (the plugin says why)
			const id = resolved?.id?.split('?')[0];
			return id && app_file(id) ? { id } : null;
		});
		return { keys: a.keys === 'unknown' ? 'all' : a.keys, why: a.why };
	};
}

function runner_offset(): number {
	const AsyncFunction = async function () {}.constructor as new (...a: string[]) => () => unknown;
	const src = new AsyncFunction('a', 'b', '/*code*/').toString();
	return src.slice(0, src.indexOf('/*code*/')).split('\n').length - 1 + 1;
}

type MapLike = { version?: number; mappings?: string; [k: string]: unknown };
type Graph = {
	getModuleById(id: string): { transformResult?: { map?: MapLike | null } | null } | undefined;
};

/**
 * THE BROWSER'S MODULES, TOO: a CPU trace from the browser names a frame by the URL the dev server
 * served (`/src/lib/Save.svelte?t=…`) at the SERVED code's lines — a `.svelte` file's compiled output,
 * not its source. The client module graph holds each served module's map (the browser runs the code
 * as served: no header to shift by). Looked up by the URL's path, then with its query minus Vite's
 * `t=` / `v=` stamps (a virtual island id keeps its own query).
 */
export const DEV_CLIENT_MAPS: unique symbol = Symbol.for('ogygia.profiler.dev-client-maps');

type ClientGraph = {
	urlToModuleMap?: Map<
		string,
		{ transformResult?: { map?: { mappings?: unknown } | null } | null }
	>;
};

export function install_dev_client_maps(server: ViteDevServer): void {
	const graph = () =>
		(server as unknown as { environments?: Record<string, { moduleGraph?: ClientGraph }> })
			.environments?.client?.moduleGraph;
	(globalThis as Record<symbol, unknown>)[DEV_CLIENT_MAPS] = (url: string): string | undefined => {
		const by_url = graph()?.urlToModuleMap;
		if (!by_url) return undefined;
		const q = url.indexOf('?');
		const path = q === -1 ? url : url.slice(0, q);
		const keys = [path];
		if (q !== -1) {
			const kept = url
				.slice(q + 1)
				.split('&')
				.filter((p) => !p.startsWith('t=') && !p.startsWith('v='));
			if (kept.length) keys.unshift(`${path}?${kept.join('&')}`);
		}
		for (const k of keys) {
			const map = by_url.get(k)?.transformResult?.map;
			if (map && typeof map.mappings === 'string') return JSON.stringify(map);
		}
		return undefined;
	};
}

export function install_dev_maps(server: ViteDevServer): void {
	const offset = runner_offset();
	const graph = () => {
		const envs = (server as unknown as { environments?: Record<string, { moduleGraph?: Graph }> })
			.environments;
		return envs?.ssr?.moduleGraph;
	};
	(globalThis as Record<symbol, unknown>)[DEV_MAPS] = (id: string): string | undefined => {
		const map = graph()?.getModuleById(id)?.transformResult?.map;
		if (!map || typeof map.mappings !== 'string') return undefined;
		return JSON.stringify({ ...map, mappings: ';'.repeat(offset) + map.mappings });
	};
}
