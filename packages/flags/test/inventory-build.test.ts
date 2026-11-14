/**
 * The flag inventory inside a REAL `vite build`: with `flags()` beside `ogygia()` the build writes
 * `node_modules/.ogygia/flags-manifest.json` from every module importing the package (used or not);
 * without it there is no manifest, and the build says once that the plugin is not listed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type PluginOption } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from '@ogygia/compiler/vite';
import { dedent } from '@ogygia/core/plugin/utils';
import { flags } from '../src/vite.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

let root = '';
afterEach(() => {
	vi.restoreAllMocks();
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = '';
});

/** A throwaway app: `src/main.ts` reads one flag; `src/lib/unused.ts` declares one nothing imports. */
function app(): string {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flags-inventory-')));
	const files: Record<string, string> = {
		'package.json': JSON.stringify({ name: 'app', type: 'module' }),
		'src/main.ts': dedent`
			import { flag } from '@ogygia/flags';
			export const checkout = flag('checkout-v2', 25);
		`,
		'src/lib/unused.ts': dedent`
			import { flag as f } from '@ogygia/flags';
			export const old = f('old-banner', 50);
		`
	};
	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
	}
	fs.mkdirSync(path.join(root, 'node_modules', '@ogygia'), { recursive: true });
	fs.symlinkSync(PACKAGE_DIR, path.join(root, 'node_modules', '@ogygia', 'flags'), 'dir');
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');
	return root;
}

const run = (dir: string, plugins: PluginOption[]) =>
	build({
		root: dir,
		logLevel: 'silent',
		configFile: false,
		plugins: [...plugins, svelte({ configFile: false })],
		build: {
			// written: the inventory is written once the client output is
			outDir: path.join(dir, 'dist'),
			minify: false,
			rolldownOptions: {
				input: path.join(dir, 'src', 'main.ts'),
				preserveEntrySignatures: 'strict',
				external: ['@ogygia/flags']
			}
		}
	});

const MANIFEST = (dir: string) => path.join(dir, 'node_modules', '.ogygia', 'flags-manifest.json');

describe('the flag inventory', () => {
	it('with flags() listed, a build writes every flag site, the unused module too', async () => {
		const dir = app();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await run(dir, [ogygia(), flags()]);
		const manifest = JSON.parse(fs.readFileSync(MANIFEST(dir), 'utf8'));
		expect(manifest.names).toEqual(['checkout-v2', 'old-banner']);
		expect(manifest.flags).toContainEqual({
			name: 'old-banner',
			kind: 'flag',
			file: 'src/lib/unused.ts',
			line: 2
		});
	});

	it('without flags() there is no manifest, and the build says the plugin is not listed', async () => {
		const dir = app();
		const said: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
			said.push(a.map(String).join(' '));
		});
		await run(dir, [ogygia()]);
		expect(fs.existsSync(MANIFEST(dir))).toBe(false);
		expect(said.filter((s) => s.includes('plugin_not_listed'))).toHaveLength(1);
		expect(said.join('\n')).toContain('flags()');
	});
});
