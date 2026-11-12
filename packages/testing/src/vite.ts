/**
 * `testing()`, listed beside `ogygia()` in vite.config: the app's runtime hands its hooks to the
 * testing engine a test injects (`withOgygia`, or a driver's `addInitScript`), so `page()`,
 * `hydration()`, `record()` and `settled()` work without devtools. A visitor has no engine: the
 * page pays one global read per hook, and nothing runs.
 *
 *   plugins: [ogygia(), testing(), sveltekit()]
 *
 * `profile()` reads the SSR profiler, which comes with `devtools({ profiler })`.
 */
import type { Plugin as VitePlugin } from 'vite';
import { definePlugin, type OgygiaPlugin, type RegionsSeam } from '@ogygia/compiler/vite';

/** The dev server's names endpoint the engine asks (devtools' dock serves the same path, with more). */
const NAMES_PATH = '/__ogygia_devtools_meta';

export function testing(): [OgygiaPlugin, VitePlugin] {
	let regions: RegionsSeam | null = null;
	const plugin = definePlugin({
		name: '@ogygia/testing',
		client: import.meta.resolve('./client.ts'),
		build(b) {
			if (b.dev) regions = b.regions;
		}
	});
	return [plugin, names_plugin(() => regions)];
}

/** In dev, the regions' component names, read live (a build lends them from the app's own chunk). */
function names_plugin(regions: () => RegionsSeam | null): VitePlugin {
	return {
		name: 'ogygia:testing-names',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const seam = regions();
				if (!seam || (req.url || '').split('?')[0] !== NAMES_PATH) return next();
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ names: seam.names() }));
			});
		}
	};
}
