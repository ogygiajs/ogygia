/**
 * `bake()` beside `ogygia()` inside a REAL Vite build: the call is baked through the app's `$lib`
 * alias and the import that fed it leaves the bundle; without the plugin the same app fails the
 * build with `macro_needs_plugin`, and the function never runs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type PluginOption, type Rollup } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from '@ogygia/compiler/vite';
import { __set_build_cache_root, dedent } from '@ogygia/compiler';
import { bake } from '../src/index.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

let root = '';
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = '';
});

/** A throwaway app on disk: `src/main.ts` bakes `nav()` from `$lib/nav.ts`. */
function app(): string {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bake-plugin-')));
	__set_build_cache_root(path.join(root, 'node_modules', '.ogygia'));
	const files: Record<string, string> = {
		'package.json': JSON.stringify({ name: 'app', type: 'module' }),
		'src/lib/nav.ts': `export function nav() { globalThis.__baked_at_run_time = true; return { items: ['home', 'about'], when: new Date(0) }; }`,
		'src/main.ts': dedent`
			import { nav } from '$lib/nav';
			export const NAV = import.meta.og.bake(() => nav());
		`
	};
	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
	}
	// ogygia() finds a listed plugin by its package, resolved from the app
	fs.mkdirSync(path.join(root, 'node_modules', '@ogygia'), { recursive: true });
	fs.symlinkSync(PACKAGE_DIR, path.join(root, 'node_modules', '@ogygia', 'bake'), 'dir');
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');
	return root;
}

const run = async (dir: string, plugins: PluginOption[]) =>
	(await build({
		root: dir,
		logLevel: 'silent',
		configFile: false,
		resolve: { alias: { $lib: path.join(dir, 'src', 'lib') } },
		plugins: [...plugins, svelte({ configFile: false })],
		build: {
			write: false,
			minify: false,
			rolldownOptions: {
				input: path.join(dir, 'src', 'main.ts'),
				preserveEntrySignatures: 'strict'
			}
		}
	})) as Rollup.RolldownOutput;

describe('bake() beside ogygia()', () => {
	it('bakes the call through the app alias, and the import that fed it leaves the bundle', async () => {
		const out = await run(app(), [ogygia(), bake()]);
		const chunk = out.output.find((c) => c.type === 'chunk' && c.isEntry) as Rollup.OutputChunk;
		expect(chunk.code).toContain('"home"');
		expect(chunk.code).toContain('new Date(0)');
		expect(chunk.code).not.toContain('import.meta.og.bake');
		expect(chunk.code).not.toContain('__baked_at_run_time');
	});

	it('the module a bake bundled is a watch file of the build, so an edit to it re-bakes', async () => {
		const dir = app();
		const watched: string[] = [];
		// Rolldown has no getWatchFiles(): spy on the transform context ogygia() is handed
		const plugins = ([ogygia()] as PluginOption[]).flat(Infinity as 1) as Plugin[];
		for (const p of plugins) {
			const hook = p.transform;
			if (typeof hook !== 'function') continue;
			p.transform = function (this: Rollup.TransformPluginContext, ...args) {
				const spied = Object.create(this) as Rollup.TransformPluginContext;
				spied.addWatchFile = (file) => {
					watched.push(file.split('?')[0]!);
					this.addWatchFile(file);
				};
				return hook.apply(spied, args);
			} as typeof hook;
		}
		await run(dir, [...plugins, bake()]);
		expect(watched).toContain(path.join(dir, 'src', 'lib', 'nav.ts'));
	});

	it('without bake() the build fails with macro_needs_plugin, and nothing runs', async () => {
		const dir = app();
		delete (globalThis as { __baked_at_run_time?: boolean }).__baked_at_run_time;
		await expect(run(dir, [ogygia()])).rejects.toThrow(/macro_needs_plugin|@ogygia\/bake/);
		expect((globalThis as { __baked_at_run_time?: boolean }).__baked_at_run_time).toBeUndefined();
	});
});
