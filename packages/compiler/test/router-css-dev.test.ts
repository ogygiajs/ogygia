/**
 * Router page CSS in dev (#249): a real Vite dev server renders a router page's head through
 * `componentCssHead()` (plugin/css.ts), loaded the two ways an app's server loads it (Kit 2 through
 * `ssrLoadModule`, Kit 3 through the ssr environment's runner). The page's component is a real
 * dev-compiled Svelte component; `ogygia:server/router-css` is the real dev registry
 * (`router_css_module`), served and invalidated on style edits the way the ogygia plugin does it.
 *
 * One failed read of the registry (a load that throws once: the tree walk's resolver failing while
 * the server restarts, a file read mid-write) must not drop the page's CSS for every render after
 * it. An edit to a style the registry inlined must reach the next render.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Plugin, type RunnableDevEnvironment, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { router_css_module } from '../src/link/router-css.ts';
import { dedent } from '@ogygia/core/contract';

const own = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const V = 'ogygia:server/router-css';

type Load = (srv: ViteDevServer, url: string) => Promise<Record<string, unknown>>;
const LOADERS: Array<[string, Load]> = [
	['ssrLoadModule', (srv, url) => srv.ssrLoadModule(url)],
	[
		"the ssr environment's runner",
		(srv, url) => (srv.environments.ssr as RunnableDevEnvironment).runner.import(url)
	]
];

const shell = (color: string) =>
	`${dedent`
		<header class="top">shell</header>
		<style>
			.top { color: ${color}; }
		</style>
	`}\n`;

let server: ViteDevServer | null = null;
let root = '';
afterEach(async () => {
	await server?.close();
	server = null;
	if (root) rmSync(root, { recursive: true, force: true });
});

/** The app on disk and its dev server. `failures`: how many loads of the registry throw first. */
async function start(
	failures = 0
): Promise<{ srv: ViteDevServer; write: (rel: string, text: string) => void }> {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-rcss-dev-')));
	const write = (rel: string, text: string) => {
		mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		writeFileSync(path.join(root, rel), text);
	};
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	mkdirSync(path.join(root, 'node_modules'));
	for (const dep of ['svelte', 'esm-env'])
		symlinkSync(
			realpathSync(own(`../../core/node_modules/${dep}`)),
			path.join(root, 'node_modules', dep)
		);
	write('src/Shell.svelte', shell('red'));
	// a router page module: renders the shell and asks for its head tags
	write(
		'src/page.ts',
		`${dedent`
			import Shell from './Shell.svelte';
			import { componentCssHead } from ${JSON.stringify(own('../../core/src/plugin/css.ts'))};
			export const head = () => componentCssHead([Shell]);
		`}\n`
	);
	let left = failures;
	const registry: Plugin = {
		name: 'router-css-registry',
		resolveId: (id) => (id === V ? `\0${V}` : undefined),
		async load(id) {
			if (id !== `\0${V}`) return;
			if (left-- > 0) throw new Error('the registry failed to emit');
			return router_css_module([path.join(root, 'src/Shell.svelte')], {
				root,
				lib_dir: path.join(root, 'src/lib'),
				is_dev: true,
				read_file: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
			});
		},
		// what the ogygia plugin does on a style-bearing edit (vite/index.ts handleHotUpdate)
		handleHotUpdate({ file, server }) {
			if (!/\.(svelte|css)$/.test(file)) return;
			const mod = server.moduleGraph.getModuleById(`\0${V}`);
			if (mod) server.moduleGraph.invalidateModule(mod);
		}
	};
	server = await createServer({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [registry, svelte({ configFile: false })],
		resolve: {
			alias: [
				{
					find: /^ogygia\/internal\/register$/,
					replacement: own('../../core/src/internal-register.ts')
				},
				{ find: /^\$app\/(.*)$/, replacement: own('../../core/test/_stubs/app-$1.ts') },
				{
					find: /^ogygia:(server|boot|region|dev)$/,
					replacement: own('../../core/test/_stubs/realm-$1.ts')
				},
				{
					find: /^ogygia:(server|boot|region|dev)\/(?!router-css$)([^/]+)$/,
					replacement: own('../../core/test/_stubs/$1.$2.ts')
				}
			]
		},
		server: { middlewareMode: true, ws: false }
	});
	// macOS reports the fixture's own writes a moment after the watcher starts: let them pass
	let last = Date.now();
	const seen = () => (last = Date.now());
	server.watcher.on('all', seen);
	while (Date.now() - last < 300) await new Promise((r) => setTimeout(r, 50));
	server.watcher.off('all', seen);
	return { srv: server, write };
}

const color = (head: string) => /color: (\w+)/.exec(head)?.[1] ?? null;
const render = async (load: Load, srv: ViteDevServer) =>
	color(await ((await load(srv, '/src/page.ts')).head as () => Promise<string>)());

describe.each(LOADERS)(
	'router page CSS in dev (#249), loaded by %s',
	{ timeout: 30_000 },
	(_, load) => {
		it('one failed read of the registry: the next render links the page CSS', async () => {
			const { srv } = await start(1);
			expect(await render(load, srv)).toBe(null); // the failed read: this render has no CSS
			expect(await render(load, srv)).toBe('red');
			expect(await render(load, srv)).toBe('red');
		});

		it('an edit to the page style: the next render links the edited CSS', async () => {
			const { srv, write } = await start();
			expect(await render(load, srv)).toBe('red');
			write('src/Shell.svelte', shell('blue'));
			const until = Date.now() + 10_000;
			let now = await render(load, srv);
			while (now !== 'blue' && Date.now() < until) {
				await new Promise((r) => setTimeout(r, 25));
				now = await render(load, srv);
			}
			expect(now).toBe('blue');
		});
	}
);
