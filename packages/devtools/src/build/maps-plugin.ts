/**
 * The profiler's build maps, as `devtools({ profiler })`'s own Vite plugins: hidden sourcemaps for
 * the server build (and the client's, moved off the output), the module map beside the server
 * chunks, and both written into the profiler's maps module before the adapter copies the output.
 */
import type { Plugin as VitePlugin } from 'vite';
import { write_module_map } from './module-map.ts';
import { fill_profiler_maps } from './profiler-maps.ts';
import { server_sourcemaps_plugin } from './server-sourcemaps.ts';

interface Leg {
	environment?: { name?: string; config?: { consumer?: string } };
}

export function profiler_maps_plugins(): VitePlugin[] {
	let root = '';
	let is_build = false;
	let is_ssr = false;
	/** the server build's output, waiting for closeBundle to fill the maps module */
	let pending: { dir: string; bundle: Record<string, unknown> } | null = null;
	const maps: VitePlugin = {
		name: 'ogygia:profiler-maps',
		configResolved(config) {
			root = config.root;
			is_build = config.command === 'build';
			is_ssr = !!config.build?.ssr;
		},
		writeBundle(options, bundle) {
			const env = (this as Leg | null)?.environment;
			const server_leg = env ? env.name === 'ssr' || env.config?.consumer === 'server' : is_ssr;
			if (!is_build || !server_leg || !options.dir) return;
			// which source module sits at which lines of each server chunk, written beside the chunks
			try {
				write_module_map(options.dir, bundle as Record<string, unknown>, root);
			} catch {
				// ok: a module map is a nicety; the build never fails over it
			}
			pending = { dir: options.dir, bundle: bundle as Record<string, unknown> };
		},
		// after every plugin's writeBundle (Kit rewrites remote-function chunks in its own) and before
		// Kit's sequential closeBundle hands the output to the adapter
		closeBundle: {
			order: 'pre',
			sequential: true,
			handler() {
				if (!pending) return;
				const { dir, bundle } = pending;
				pending = null;
				try {
					fill_profiler_maps(dir, bundle, root);
				} catch {
					// ok: the profiler then reads the files beside the chunks, where they exist
				}
			}
		}
	};
	return [maps, server_sourcemaps_plugin(() => true)];
}
