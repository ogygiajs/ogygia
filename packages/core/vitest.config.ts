import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { browser_runs, playwright_run } from '@ogygia/config/vitest';
import { fileURLToPath } from 'node:url';
import { heisenbench_record } from '../../internal/heisenbench/src/record.ts';
import type { BrowserCommand } from 'vitest/node';
import { lazy_files } from './src/vite/lazy-files.ts';

/**
 * The network, for the browser tests (`commands` from `vitest/browser`), by the path each names:
 *
 * - `drop_downloads(path, times)`: the next `times` requests for a URL whose path ends with `path`
 *   fail at the network, as on a dropped connection (Playwright's `route.abort`); the ones after go
 *   through. A real failed download, so the browser keeps that module failed the way it does for a
 *   visitor.
 * - `hold_downloads(path)`: every request for it waits, unanswered, as on a slow network. A
 *   stylesheet still loading, for real.
 * - `keep_downloads(path)` lifts either, and sends the held requests on.
 *
 * Test files run side by side in one browser page, so each lifts only what it named: lifting every
 * route let one file's held sheet load in the middle of another file's test.
 */
type Routed = { matches: (url: URL) => boolean; held: Array<() => Promise<void>> };
const routed = new Map<string, Routed>();
function route_of(path: string): Routed {
	const r: Routed = { matches: (url) => url.pathname.endsWith(path), held: [] };
	routed.set(path, r);
	return r;
}
const drop_downloads: BrowserCommand<[path: string, times: number]> = async (ctx, path, times) => {
	let left = times;
	await ctx.page.route(route_of(path).matches, (route) =>
		left-- > 0 ? route.abort('failed') : route.continue()
	);
};
const hold_downloads: BrowserCommand<[path: string]> = async (ctx, path) => {
	const r = route_of(path);
	await ctx.page.route(r.matches, (route) => void r.held.push(() => route.continue()));
};
const keep_downloads: BrowserCommand<[path: string]> = async (ctx, path) => {
	const r = routed.get(path);
	if (!r) return;
	routed.delete(path);
	await ctx.page.unroute(r.matches);
	for (const send of r.held.splice(0)) await send().catch(() => {});
};

// Two projects, one config:
//
// - `node`   — unit tests for the library internals (the transform, the content pipeline, the pure
//              runtime modules). They import the BUILT `dist/` output, so root `pnpm run check` builds
//              the lib before invoking `vitest run` (via the package `check` script).
// - `browser` — island tests in a REAL browser (Vitest browser mode, Playwright chromium). `setup.ts`
//              server-renders the fixture islands in Node and `provide()`s the HTML; each test drops
//              it into the document, boots the real runtime, and watches the island wake. No jsdom:
//              the runtime is a custom element + `hydrate()`, and only a browser tells the truth.
//
// vitest 4 pairs with vite 8 / Rolldown — its `vite` peer range is `^6 || ^7 || ^8`, verified
// empirically against the workspace vite 8.2.0.
export default defineConfig({
	// Some suites import library SOURCE (the content pipeline), which now transitively reaches `.svelte`
	// files (e.g. `RenderSnippet.svelte` behind the region-snippet capture). The Svelte plugin lets those
	// parse; dist-importing suites are unaffected (they resolve `.js`). The browser project needs it for
	// the island fixtures (client compile) and their SSR twin in `setup.ts` (server compile).
	// heisenbench_record(): nothing, unless the measurement-source gate records the tests' inputs
	// (internal/heisenbench/src/record.ts)
	plugins: [svelte(), ...heisenbench_record()],
	// The browser tests' dependencies, bundled before the first test file loads: found during the
	// run, Vite bundles again and changes the URLs a test file still imports.
	optimizeDeps: { include: ['devalue', 'esm-env', 'fast-check'] },
	resolve: {
		alias: {
			'$app/server': fileURLToPath(new URL('./test/_stubs/app-server.ts', import.meta.url)),
			// The `ogygia/content` barrel now carries the site kit's shell components, whose graph
			// reads `$app/state` and (via Doc → Region.svelte) the plugin's virtual modules — stub
			// them so barrel-importing suites load without a Kit app or the Vite plugin.
			'$app/state': fileURLToPath(new URL('./test/_stubs/app-state.ts', import.meta.url)),
			'$app/paths': fileURLToPath(new URL('./test/_stubs/app-paths.ts', import.meta.url)),
			'$app/env': fileURLToPath(new URL('./test/_stubs/app-env.ts', import.meta.url)),
			'virtual:ogygia/runtime-url': fileURLToPath(
				new URL('./test/_stubs/virtual-runtime-url.ts', import.meta.url)
			),
			'virtual:ogygia/router-config': fileURLToPath(
				new URL('./test/_stubs/virtual-router-config.ts', import.meta.url)
			),
			'virtual:ogygia/profiler-config': fileURLToPath(
				new URL('./test/_stubs/virtual-profiler-config.ts', import.meta.url)
			),
			'virtual:ogygia/profiler-maps': fileURLToPath(
				new URL('./test/_stubs/virtual-profiler-maps.ts', import.meta.url)
			),
			'virtual:ogygia/dev-hmr-url': fileURLToPath(
				new URL('./test/_stubs/virtual-dev-hmr-url.ts', import.meta.url)
			),
			'virtual:ogygia/island-deps': fileURLToPath(
				new URL('./test/_stubs/virtual-island-deps.ts', import.meta.url)
			),
			'virtual:ogygia/devtools-meta': fileURLToPath(
				new URL('./test/_stubs/virtual-devtools-meta.ts', import.meta.url)
			),
			'virtual:ogygia/hydrate-features': fileURLToPath(
				new URL('./test/_stubs/virtual-hydrate-features.ts', import.meta.url)
			),
			'virtual:ogygia/runtime-flags': fileURLToPath(
				new URL('./test/_stubs/virtual-runtime-flags.ts', import.meta.url)
			),
			'virtual:ogygia/transportables': fileURLToPath(
				new URL('./test/_stubs/virtual-transportables.ts', import.meta.url)
			),
			'virtual:ogygia/kit-wire': fileURLToPath(
				new URL('./test/_stubs/virtual-kit-wire.ts', import.meta.url)
			),
			'virtual:ogygia/region-endpoint': fileURLToPath(
				new URL('./test/_stubs/virtual-region-endpoint.ts', import.meta.url)
			),
			'virtual:ogygia/request-event': fileURLToPath(
				new URL('./test/_stubs/virtual-request-event.ts', import.meta.url)
			),
			'virtual:ogygia/route-csr': fileURLToPath(
				new URL('./test/_stubs/virtual-route-csr.ts', import.meta.url)
			),
			// The server graph `ogygia/internal/server` loads (the region signer) — reached by the
			// profiler's modules (packages/devtools) a suite here imports.
			'virtual:ogygia/secret': fileURLToPath(
				new URL('./test/_stubs/virtual-secret.ts', import.meta.url)
			),
			'virtual:ogygia/sign': fileURLToPath(
				new URL('./test/_stubs/virtual-sign.ts', import.meta.url)
			),
			'virtual:ogygia/session-cookie': fileURLToPath(
				new URL('./test/_stubs/virtual-session-cookie.ts', import.meta.url)
			),
			'virtual:ogygia/region-ttl': fileURLToPath(
				new URL('./test/_stubs/virtual-region-ttl.ts', import.meta.url)
			),
			'virtual:ogygia/server-manifest': fileURLToPath(
				new URL('./test/_stubs/virtual-server-manifest.ts', import.meta.url)
			),
			// The browser runtime (`runtime/core.ts` → `app-transport.ts`) reads the app's transport codecs.
			'virtual:ogygia/transport': fileURLToPath(
				new URL('./test/_stubs/virtual-transport.ts', import.meta.url)
			)
		}
	},
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					include: ['test/**/*.test.ts'],
					exclude: ['test/browser/**', '**/node_modules/**'],
					environment: 'node',
					// the runtime's messages, published as the runtime's boot and the server's handle do
					setupFiles: ['./test/_setup/messages.ts']
				}
			},
			{
				extends: true,
				// each lazy loader's own file, as an app's build hands it over (the ogygia plugin
				// always carries it): a dropped download is asked for again there
				plugins: [lazy_files()],
				test: {
					name: 'browser',
					include: ['test/browser/**/*.test.ts'],
					globalSetup: ['./test/browser/setup.ts'],
					browser: {
						enabled: true,
						headless: true,
						...(await browser_runs()),
						// (network routes are Playwright's: real Firefox runs without them, and the tests
						// that need them say so, test/browser/_browsers.ts)
						...(playwright_run()
							? { commands: { drop_downloads, hold_downloads, keep_downloads } }
							: {})
					}
				}
			}
		]
	}
});
