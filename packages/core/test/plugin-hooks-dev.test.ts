/**
 * Plugin hooks in dev (#251): a real Vite dev server loads the app's server hooks the way Kit does
 * (the app's `hooks.server.ts` imports `ogygia/server`, core's handle module, which makes the
 * plugins listed in `ogygia:server/server-plugins` live), by both loaders an app's server uses
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
const V = 'ogygia:server/server-plugins';

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

/** The edit of the plugin's body that the plugin's module last ran with. */
const ran = (): number | undefined =>
	(globalThis as Record<string, unknown>).__og_hooks_dev_ran as number | undefined;

/** A plugin whose answer and whose notes name the run of its module (`edit` in its body). */
const answering = `import { edit } from './answering-body.ts';
globalThis.__og_hooks_dev_ran = edit;
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
	delete (globalThis as Record<string, unknown>).__og_hooks_dev_ran;
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
	// the plugin list the build makes (`ogygia:server/server-plugins`), as the compiler emits it
	const plugin_list: Plugin = {
		name: 'server-plugins',
		resolveId: (id) => (id === V ? '\0' + V : undefined),
		load: (id) =>
			id === '\0' + V
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
				{ find: /^ogygia:(server|boot|region|dev)$/, replacement: own('./_stubs/realm-$1.ts') },
				{
					find: /^ogygia:(server|boot|region|dev)\/(?!server-plugins$)([^/]+)$/,
					replacement: own('./_stubs/$1.$2.ts')
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

/**
 * Loads the app's hooks as the next request does, until they have run again with edit `n` of the
 * plugin's body. A new hooks module alone does not say that: a late watcher report of another file
 * (macOS reports the fixture's own writes late under load) runs the hooks again before Vite has
 * invalidated the edited body, and that run still holds the old plugin.
 */
async function reloaded(load: Load, srv: ViteDevServer, n: number): Promise<void> {
	const until = Date.now() + 45_000;
	while (Date.now() < until) {
		await load(srv, '/src/hooks.server.ts');
		if (ran() === n) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`the hooks never ran again with edit ${n} of the plugin`);
}

describe.each(LOADERS)(
	'plugin hooks in dev (#251), loaded by %s',
	{ timeout: 120_000 },
	(_, load) => {
		it('two edits of a plugin: only its current run answers and hears; the other plugin hears once', async () => {
			const { srv, edit } = await start();
			await load(srv, '/src/hooks.server.ts');
			expect(ran()).toBe(0);
			expect(await ask.lastBuild('v')).toBe('answer of run 0');

			for (const n of [1, 2]) {
				await edit('plugins/answering-body.ts', `export const edit = ${n};\n`);
				await reloaded(load, srv, n);
				expect(await ask.lastBuild('v')).toBe(`answer of run ${n}`);
			}

			await notify.invalidate(['p:/']);
			expect(heard().sort()).toEqual(['answering, run 2', 'quiet']);
		});
	}
);
