/**
 * A second build in one process (`vite build --watch`, a harness calling `build()` twice) starts
 * from nothing: after an edit between the builds, its output equals a cold build of the same files.
 * The entry imports no page, so every region chunk comes from the build's scan of `src/`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { build, type PluginOption, type Rollup } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { dedent } from '@ogygia/core/contract';
import { ogygia } from '../src/vite/index.ts';

let root = '';
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = '';
});

function write(rel: string, text: string): void {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, text);
}

const page = (...marks: string[]): string =>
	`${dedent`
		<script>
			${marks.map((m) => `import ${m} from '$lib/${m}.svelte' with { wake: 'visible' };`).join('\n')}
		</script>
		${marks.map((m) => `<${m} />`).join('')}
	`}\n`;

/** A throwaway app: one page marking `$lib/W.svelte` as a region, under a layout setting `csr`. */
function app(csr: boolean): void {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-second-build-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	write('src/entry.ts', 'export const entry = 1;\n');
	write('src/routes/+layout.ts', `export const csr = ${csr};\n`);
	write('src/routes/+page.svelte', page('W'));
	write('src/lib/W.svelte', `<p>w</p>\n`);
	write('src/lib/V.svelte', `<p>v</p>\n`);
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');
}

/** One client build with `plugins`: its output as sorted `[file name, text]`. */
async function run(plugins: PluginOption[]): Promise<Array<[string, string]>> {
	const out = (await build({
		root,
		logLevel: 'silent',
		configFile: false,
		resolve: { alias: { $lib: path.join(root, 'src', 'lib') } },
		plugins: [...plugins, svelte({ configFile: false })],
		build: {
			write: false,
			minify: false,
			rolldownOptions: { input: path.join(root, 'src', 'entry.ts') }
		}
	})) as Rollup.RolldownOutput;
	return out.output
		.map((o): [string, string] => [o.fileName, o.type === 'chunk' ? o.code : String(o.source)])
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const regions = (out: Array<[string, string]>) =>
	out.filter(([name]) => name.includes('/og-region.')).length;

describe('a second build in one process', () => {
	it('sees a region added between the builds, like a cold build', async () => {
		app(false);
		const plugins = ogygia();
		expect(regions(await run(plugins))).toBe(1);
		write('src/routes/+page.svelte', page('W', 'V'));
		const second = await run(plugins);
		expect(regions(second)).toBe(2);
		expect(second).toEqual(await run(ogygia()));
	});

	it('reads a csr flipped between the builds, like a cold build', async () => {
		app(true);
		const plugins = ogygia();
		expect(regions(await run(plugins))).toBe(0);
		write('src/routes/+layout.ts', 'export const csr = false;\n');
		const second = await run(plugins);
		expect(regions(second)).toBe(1);
		expect(second).toEqual(await run(ogygia()));
	});
});
