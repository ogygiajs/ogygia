import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { browser_runs, playwright_run, stub_aliases } from '@ogygia/config/vitest';
import { heisenbench_record } from '../../internal/heisenbench/src/record.ts';
import type { BrowserCommand, BrowserCommandContext } from 'vitest/node';
import type {} from '@vitest/browser-playwright';

type Frame = Awaited<ReturnType<BrowserCommandContext['frame']>>;

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
 * Test files run side by side in one browser page, each in its own frame, so a route touches only
 * the requests of the frame that named it, and each file lifts only what it named: one file's drop
 * spent on another file's download of the same module let both tests see the wrong network.
 */
type Routed = { matches: (url: URL) => boolean; held: Array<() => Promise<void>> };
const routed = new Map<Frame, Map<string, Routed>>();
async function route_of(ctx: BrowserCommandContext, path: string): Promise<[Routed, Frame]> {
	const frame = await ctx.frame();
	const r: Routed = { matches: (url) => url.pathname.endsWith(path), held: [] };
	let mine = routed.get(frame);
	if (!mine) routed.set(frame, (mine = new Map()));
	mine.set(path, r);
	return [r, frame];
}
const drop_downloads: BrowserCommand<[path: string, times: number]> = async (ctx, path, times) => {
	const [r, frame] = await route_of(ctx, path);
	let left = times;
	await ctx.page.route(r.matches, (route) =>
		route.request().frame() !== frame
			? route.fallback()
			: left-- > 0
				? route.abort('failed')
				: route.continue()
	);
};
const hold_downloads: BrowserCommand<[path: string]> = async (ctx, path) => {
	const [r, frame] = await route_of(ctx, path);
	await ctx.page.route(r.matches, (route) =>
		route.request().frame() !== frame ? route.fallback() : void r.held.push(() => route.continue())
	);
};
const keep_downloads: BrowserCommand<[path: string]> = async (ctx, path) => {
	const mine = routed.get(await ctx.frame());
	const r = mine?.get(path);
	if (!r) return;
	mine!.delete(path);
	await ctx.page.unroute(r.matches);
	for (const send of r.held.splice(0)) await send().catch(() => {}); // ok: a held request whose page closed has no one to answer
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
	// Kit's `$app/*` and ogygia's virtual modules (the realm modules and their entries), stubbed so
	// suites load without a Kit app or the Vite plugin (test/_stubs, by file name)
	resolve: { alias: stub_aliases() },
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
				// as an app with a plugin's browser half builds: the runtime boots the plugins a test hands it
				define: { __OGYGIA_CLIENT_PLUGINS__: 'true' },
				test: {
					name: 'browser',
					include: ['test/browser/**/*.test.ts'],
					globalSetup: ['./test/browser/setup.ts'],
					// a failing test prints its machine moves
					setupFiles: ['@ogygia/tooling/vitest/trace-setup'],
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
