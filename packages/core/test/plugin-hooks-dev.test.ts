/**
 * Plugin hooks in dev (#251): a real Vite dev server loads the app's server hooks the way Kit does
 * (the app's `hooks.server.ts` imports `ogygia/server`, core's handle module, which makes the
 * plugins listed in `virtual:ogygia/server-plugins` live), by both loaders an app's server uses
 * (Kit 2 through `ssrLoadModule`, Kit 3 through the ssr environment's runner).
 *
 * An edit to a plugin's server half (or anything it imports) runs it again, and with it the handle
 * module: new plugin objects start. The ones they replace must leave the shared hooks, or `notify`
 * keeps running on them and `ask` answers from the oldest.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Plugin, type RunnableDevEnvironment, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { server_plugins_module } from '../src/compiler/link/caps.ts';
import { ask, notify } from '../src/plugin/hooks.ts';
import { edit as dev_edit } from './_dev-edit.ts';

const own = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const V = 'virtual:ogygia/server-plugins';

type Load = (srv: ViteDevServer, url: string) => Promise<Record<string, unknown>>;
const LOADERS: Array<[string, Load]> = [
	['ssrLoadModule', (srv, url) => srv.ssrLoadModule(url)],
	[
		"the ssr environment's runner",
		(srv, url) => (srv.environments.ssr as RunnableDevEnvironment).runner.import(url)
	]
];

const heard = (): string[] =>
	((globalThis as Record<string, unknown>).__og_hooks_dev_heard ??= []) as string[];

/** A plugin whose answer and whose notes name the run of its module (`edit` in its body). */
const answering = `import { edit } from './answering-body.ts';
export default {
	lastBuild: () => 'answer of run ' + edit,
	invalidate: () => void globalThis.__og_hooks_dev_heard.push('answering, run ' + edit)
};
`;
/** A plugin no edit touches. */
const quiet = `export default {
	invalidate: () => void globalThis.__og_hooks_dev_heard.push('quiet')
};
`;

let server: ViteDevServer | null = null;
let root = '';
beforeEach(() => {
	heard().length = 0;
});
afterEach(async () => {
	await server?.close();
	server = null;
	if (root) rmSync(root, { recursive: true, force: true });
});

async function start(): Promise<{
	srv: ViteDevServer;
	/** An edit once the dev server runs: done when its watcher reports it. */
	edit: (rel: string, text: string) => Promise<void>;
}> {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-hooks-dev-')));
	const write = (rel: string, text: string) => {
		mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		writeFileSync(path.join(root, rel), text);
	};
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	mkdirSync(path.join(root, 'node_modules'));
	for (const dep of ['svelte', 'esm-env'])
		symlinkSync(realpathSync(own(`../node_modules/${dep}`)), path.join(root, 'node_modules', dep));
	write('plugins/answering.server.ts', answering);
	write('plugins/answering-body.ts', 'export const edit = 0;\n');
	write('plugins/quiet.server.ts', quiet);
	write(
		'src/hooks.server.ts',
		`import { handle as ogygia } from ${JSON.stringify(own('../src/hooks.ts'))};\nexport const handle = ogygia();\n`
	);
	// the plugin list the build makes (`virtual:ogygia/server-plugins`), as the compiler emits it
	const plugin_list: Plugin = {
		name: 'server-plugins',
		resolveId: (id) => (id === V ? `\0${V}` : undefined),
		load: (id) =>
			id === `\0${V}`
				? server_plugins_module(true, [
						{
							name: 'answering',
							options: null,
							module: path.join(root, 'plugins/answering.server.ts')
						},
						{ name: 'quiet', options: null, module: path.join(root, 'plugins/quiet.server.ts') }
					])
				: undefined
	};
	server = await createServer({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [plugin_list, svelte({ configFile: false })],
		resolve: {
			alias: [
				{ find: /^\$app\/(.*)$/, replacement: own('./_stubs/app-$1.ts') },
				{
					find: /^virtual:ogygia\/(?!server-plugins$)(.*)$/,
					replacement: own('./_stubs/virtual-$1.ts')
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
	const watcher = server.watcher;
	return { srv: server, edit: (rel, text) => dev_edit(watcher, path.join(root, rel), text) };
}

/** The app's hooks as the next request loads them, once an edit has run them again. */
async function reloaded(
	load: Load,
	srv: ViteDevServer,
	before: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const until = Date.now() + 10_000;
	while (Date.now() < until) {
		const mod = await load(srv, '/src/hooks.server.ts');
		if (mod !== before) return mod;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error('the edit never ran the hooks again');
}

describe.each(LOADERS)(
	'plugin hooks in dev (#251), loaded by %s',
	{ timeout: 30_000 },
	(_, load) => {
		it('two edits of a plugin: only its current run answers and hears; the other plugin hears once', async () => {
			const { srv, edit } = await start();
			let hooks = await load(srv, '/src/hooks.server.ts');
			expect(await ask.lastBuild('v')).toBe('answer of run 0');

			for (const n of [1, 2]) {
				await edit('plugins/answering-body.ts', `export const edit = ${n};\n`);
				hooks = await reloaded(load, srv, hooks);
				expect(await ask.lastBuild('v')).toBe(`answer of run ${n}`);
			}

			await notify.invalidate(['p:/']);
			expect(heard().sort()).toEqual(['answering, run 2', 'quiet']);
		});
	}
);
