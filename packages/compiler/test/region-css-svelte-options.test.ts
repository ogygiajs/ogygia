/**
 * A region's stylesheet is compiled by ogygia (the tree CSS walk), apart from the component's own
 * compile by vite-plugin-svelte. Both must scope with the same class, so ogygia compiles with the
 * app's own Svelte compiler options: an app with a custom `cssHash` gets region rules that match
 * its markup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { build, type Rollup } from 'vite';
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

function app(): void {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-region-css-options-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	write(
		'src/entry.ts',
		`${dedent`
			import 'ogygia:boot/hydrate-features';
			export const entry = 1;
		`}\n`
	);
	write('src/routes/+layout.ts', 'export const csr = false;\n');
	write(
		'src/routes/+page.svelte',
		`${dedent`
			<script>
				import Hole from '$lib/Hole.svelte' with { render: 'deferred' };
				import W from '$lib/W.svelte' with { wake: 'visible' };
			</script>
			<Hole />
			<W />
		`}\n`
	);
	write(
		'src/lib/Hole.svelte',
		`${dedent`
			<p class="hole">hole</p>
			<style>
				.hole { color: red; }
			</style>
		`}\n`
	);
	write(
		'src/lib/W.svelte',
		`${dedent`
			<p class="w">w</p>
			<style>
				.w { color: blue; }
			</style>
		`}\n`
	);
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');
}

/** The client build's CSS assets, by the start of their file name (`og-hole`, `og-region`). */
async function css_assets(): Promise<Record<string, string>> {
	const out = (await build({
		root,
		logLevel: 'silent',
		configFile: false,
		resolve: { alias: { $lib: path.join(root, 'src', 'lib') } },
		plugins: [
			...ogygia(),
			svelte({
				configFile: false,
				compilerOptions: { cssHash: ({ name }) => `app-${name?.toLowerCase()}` }
			})
		],
		build: {
			write: false,
			minify: false,
			rolldownOptions: {
				input: path.join(root, 'src', 'entry.ts'),
				external: [/^\$app\//]
			}
		}
	})) as Rollup.RolldownOutput;
	const css: Record<string, string> = {};
	for (const o of out.output)
		if (o.type === 'asset' && o.fileName.endsWith('.css'))
			css[path.basename(o.fileName).split(/[-.]/).slice(0, 2).join('-')] = String(o.source);
	return css;
}

describe("a region's stylesheet scopes with the app's Svelte options", () => {
	it("a server region's rules carry the app's custom cssHash, as its markup does", async () => {
		app();
		const css = await css_assets();
		// the island's CSS comes from vite-plugin-svelte's own compile
		expect(css['og-region']).toContain('.w.app-w');
		expect(css['og-hole']).toContain('.hole.app-hole');
		expect(css['og-hole']).not.toMatch(/svelte-[a-z0-9]+/);
	});
});
