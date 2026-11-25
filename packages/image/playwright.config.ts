// @ogygia/image's e2e suite against its fixture app (e2e/app), in one of nine modes (`IMAGE_E2E_MODE`):
// - `node` (default): built with adapter-node and served (`vite preview`): files made on request;
// - `server`: the same build served by the adapter's own output (`node build`), as a deploy runs it;
// - `static`: every page prerendered with adapter-static and served as plain files, no server;
// - `dev`: the dev server;
// those four run image.spec.ts, the same pages and specs each time;
// - `base`: prerendered under `paths.base` (`/base`) and served as plain files there (base.spec.ts);
// - `cloudflare`: built with adapter-cloudflare and `cloudflare({ links: false })`, run by
//   `wrangler dev` with a local Images binding (cloudflare.spec.ts);
// - `cloudflare-links`: the same with `cloudflare()`, whose links are checked by shape
//   (cloudflare-links.spec.ts);
// - `vercel`: built with adapter-vercel and `[vercel(), sharp()]`, its static files and its function
//   served (e2e/serve-vercel.ts), its routes read by the specs (vercel.spec.ts);
// - `vercel-alone`: the same with `vercel()` alone (vercel-alone.spec.ts).
// `pnpm --filter @ogygia/image e2e` runs all nine.
import type { PlaywrightTestConfig } from '@playwright/test';
import { suite } from '@ogygia/tooling/e2e/config.ts';
import { port } from '@ogygia/tooling/e2e/servers.ts';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('./e2e/app', import.meta.url));
const build = fileURLToPath(import.meta.resolve('@ogygia/tooling/e2e/build.ts'));
const serve_static = fileURLToPath(new URL('./e2e/serve-static.ts', import.meta.url));
const serve_vercel = fileURLToPath(new URL('./e2e/serve-vercel.ts', import.meta.url));
const IGNORED = ['**/node_modules/**', '**/app/**'];
const REMOTE_HOST = fileURLToPath(new URL('./e2e/remote-host-setup.ts', import.meta.url));

function served(mode: string): PlaywrightTestConfig {
	if (mode === 'static')
		return suite({
			port: 3064,
			serve: app,
			env: { IMAGE_E2E_STATIC: '1' },
			command: `node ${build} && node ${serve_static} build/static ${port(3064)}`
		});
	if (mode === 'base')
		return suite({
			port: 3065,
			serve: app,
			ready: '/base/',
			env: { IMAGE_E2E_STATIC: '1', IMAGE_E2E_BASE: '/base' },
			command: `node ${build} && node ${serve_static} build/static ${port(3065)} /base`
		});
	if (mode === 'server')
		// @why pnpm's bin shims put its store's hoisted folder on NODE_PATH, which no deploy has (test: image.spec.ts › every file URL every page names answers 200 with its type)
		return suite({
			port: 3066,
			serve: app,
			env: { PORT: String(port(3066)) },
			command: `node ${build} && env -u NODE_PATH node build`
		});
	if (mode === 'cloudflare')
		return suite({
			port: 3067,
			serve: app,
			env: { IMAGE_E2E_ADAPTER: 'cloudflare', WRANGLER_SEND_METRICS: 'false' },
			command: `node ${build} && node node_modules/wrangler/bin/wrangler.js dev --port ${port(3067)} --ip 127.0.0.1`
		});
	if (mode === 'cloudflare-links')
		return suite({
			port: 3069,
			serve: app,
			env: {
				IMAGE_E2E_ADAPTER: 'cloudflare',
				IMAGE_E2E_LINKS: '1',
				WRANGLER_SEND_METRICS: 'false'
			},
			command: `node ${build} && node node_modules/wrangler/bin/wrangler.js dev --port ${port(3069)} --ip 127.0.0.1`
		});
	if (mode === 'vercel')
		return suite({
			port: 3068,
			serve: app,
			env: { IMAGE_E2E_ADAPTER: 'vercel' },
			command: `node ${build} && env -u NODE_PATH node ${serve_vercel} .vercel/output ${port(3068)}`
		});
	if (mode === 'vercel-alone')
		return suite({
			port: 3070,
			serve: app,
			env: { IMAGE_E2E_ADAPTER: 'vercel', IMAGE_E2E_VERCEL: 'alone' },
			command: `node ${build} && env -u NODE_PATH node ${serve_vercel} .vercel/output ${port(3070)}`
		});
	if (mode === 'dev')
		return suite({
			port: 3063,
			serve: app,
			command: `node node_modules/vite/bin/vite.js dev --port ${port(3063)} --strictPort`
		});
	return suite({ port: 3062, serve: app });
}

const OWN_SPEC: Readonly<Record<string, string>> = {
	base: 'base.spec.ts',
	cloudflare: 'cloudflare.spec.ts',
	'cloudflare-links': 'cloudflare-links.spec.ts',
	vercel: 'vercel.spec.ts',
	'vercel-alone': 'vercel-alone.spec.ts'
};
const SPECS: readonly string[] = ['image.spec.ts', ...Object.values(OWN_SPEC)];
const CHROMIUM_ONLY: ReadonlySet<string> = new Set([
	'cloudflare',
	'cloudflare-links',
	'vercel',
	'vercel-alone'
]);

function config(mode: string): PlaywrightTestConfig {
	const own = OWN_SPEC[mode] ?? 'image.spec.ts';
	const suite_config: PlaywrightTestConfig = {
		...served(mode),
		globalSetup: REMOTE_HOST,
		testIgnore: [...IGNORED, ...SPECS.filter((s) => s !== own).map((s) => `**/${s}`)]
	};
	if (!CHROMIUM_ONLY.has(mode)) return suite_config;
	const projects = (suite_config.projects ?? []).filter((p) => p.name === 'chromium');
	return projects.length
		? { ...suite_config, projects }
		: { ...suite_config, projects, webServer: undefined };
}

export default config(process.env.IMAGE_E2E_MODE ?? 'node');
