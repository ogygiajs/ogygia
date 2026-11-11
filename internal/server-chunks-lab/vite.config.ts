import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { defineConfig, type EnvironmentOptions, type Plugin } from 'vite';

/**
 * The variants of server chunking (`LAB_CHUNKS`), set on the SSR build only. The client build is
 * left exactly as it is. This is the hook an ogygia plugin would use (`config`, `isSsrBuild`).
 *   default      today's output: Rolldown's automatic chunking
 *   registry     the block registry's whole graph (blocks, their UI, icons, utils) in one chunk
 *   vendor       every node_modules module that gets bundled in one chunk
 *   grouped      a handful: registry, vendor (bundled node_modules), and the rest of the app
 *   single       every module in one chunk (entries stay as thin files that import it)
 *   single-lazy  single, with strictExecutionOrder: each module's body runs when first needed.
 *                HANGS on import (see the doc); not in the default variant list
 *   bundled      single, and node_modules bundled too (noExternal: true): no per-file loads
 *                from node_modules at run time
 *   split        bundled, as two files: the server (framework, deps, routes) and the registry
 *                graph, which only a page that renders a block loads
 */
const VARIANT = process.env.LAB_CHUNKS ?? 'default';
const GEN = /[\\/]src[\\/]lib[\\/](gen[\\/]|registry\.ts)/;

/** Svelte, Kit, ogygia (its workspace packages) and every other dependency: not app code. */
const FRAMEWORK = /node_modules|[\\/]packages[\\/]/;

type Output = Record<string, unknown>;

function server_output(variant: string): { output: Output; config?: EnvironmentOptions } {
	switch (variant) {
		case 'default':
			return { output: {} };
		case 'registry':
			return { output: { codeSplitting: { groups: [{ name: 'registry', test: GEN }] } } };
		case 'vendor':
			return { output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } } };
		case 'grouped':
			return {
				output: {
					codeSplitting: {
						groups: [
							{ name: 'registry', test: GEN, priority: 2 },
							{ name: 'vendor', test: /node_modules/, priority: 1 },
							{ name: 'app' }
						]
					}
				}
			};
		case 'single':
			return { output: { codeSplitting: { groups: [{ name: 'server' }] } } };
		case 'single-lazy':
			// hangs: Kit's server graph has import cycles and top-level await; the async init
			// wrappers strictExecutionOrder adds wait on each other (see the doc). Kept to rerun.
			return {
				output: { codeSplitting: { groups: [{ name: 'server' }] }, strictExecutionOrder: true }
			};
		case 'bundled':
			return {
				output: { codeSplitting: { groups: [{ name: 'server' }] } },
				config: { resolve: { noExternal: true } }
			};
		case 'split':
			// bundled, in two: everything but the registry graph first (higher priority), so the
			// registry chunk imports it instead of swallowing the framework, and only a page that
			// renders a block loads the registry
			return {
				output: {
					codeSplitting: {
						groups: [
							// framework and dependencies only: a group also takes its modules'
							// dependencies, so a group holding the page module would swallow the registry
							// (and Kit's preserveEntrySignatures: 'strict' refuses
							// includeDependenciesRecursively: false)
							{ name: 'server', test: FRAMEWORK, priority: 2 },
							{ name: 'registry', test: GEN, priority: 1 }
						]
					}
				},
				config: { resolve: { noExternal: true } }
			};
		default:
			throw new Error('LAB_CHUNKS: no variant named ' + variant);
	}
}

function server_chunks(): Plugin {
	return {
		name: 'lab:server-chunks',
		// Kit builds both environments in one `vite build`: the server one is named 'ssr'
		configEnvironment(name) {
			if (name !== 'ssr') return;
			const { output, config } = server_output(VARIANT);
			return { ...config, build: { rollupOptions: { output } } };
		}
	};
}

export default defineConfig({
	plugins: [server_chunks(), ogygia(), sveltekit()]
});
