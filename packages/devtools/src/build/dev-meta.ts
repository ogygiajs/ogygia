/**
 * The dock's dev endpoint, `/__ogygia_devtools_meta`: island id → component name, and island id →
 * its transitive dev-module-graph size (region-bytes.ts), both read live at request time, so the map
 * is complete once the dock fetches it (after mount, every island registered).
 */
import fs from 'node:fs';
import type { Plugin as VitePlugin } from 'vite';
import type { RegionsSeam } from '@ogygia/compiler/vite';
import { island_subgraph_bytes, type ByteGraphModule } from './region-bytes.ts';

const META_PATH = '/__ogygia_devtools_meta';

type Environments = Record<string, { moduleGraph?: { idToModuleMap?: Map<string, unknown> } }>;

/** `regions()`: the build's region table, handed over by `build(b)` (null outside a dev server). */
export function dev_meta_plugin(regions: () => RegionsSeam | null): VitePlugin {
	return {
		name: 'ogygia:devtools-meta',
		apply: 'serve',
		configureServer(server) {
			const seam = regions();
			if (!seam) return;
			// the browser's JS Self-Profiling API needs the document to opt in: every dev response carries
			// the policy, so the Page tab can sample the main thread while islands wake
			server.middlewares.use((_req, res, next) => {
				res.setHeader('document-policy', 'js-profiling');
				next();
			});
			server.middlewares.use((req, res, next) => {
				if ((req.url || '').split('?')[0] !== META_PATH) return next();
				const envs = (server as unknown as { environments?: Environments }).environments;
				const client_modules = envs?.client?.moduleGraph?.idToModuleMap?.values();
				// each app component's source, read once a request: its lines that draw differently in the browser
				const sources = new Map<string, string | undefined>();
				const read = (file: string) => {
					if (!sources.has(file)) {
						try {
							sources.set(file, fs.readFileSync(file, 'utf8'));
						} catch {
							sources.set(file, undefined);
						}
					}
					return sources.get(file);
				};
				const bytes = client_modules
					? island_subgraph_bytes(client_modules as Iterable<ByteGraphModule>, read, (f, i) =>
							seam.whyStayed(f, i)
						)
					: {};
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ names: seam.names(), bytes }));
			});
		}
	};
}
