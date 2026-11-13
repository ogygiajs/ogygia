// A SERVER REGION THE BUILD FINDS LATE IS SERVED. `ogygia:server/server-manifest` (the server
// regions' URLs, names, render ids, and the loaders behind `load_server_regions`) is loaded early: the
// handle imports it. A deferred region whose host the start-up scan never saw (a library component
// outside `src/`, outside any declared `ogygia.files`) registers only when the bundler reaches that
// host, after the manifest was loaded. It was missing from the manifest and its loaders, so its hole
// answered 403 in production (#1420). The manifest's values are now filled in from the final
// registry when each chunk is finished (link/relocations.ts), and a late region's loader is its own
// emitted chunk.
import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { dedent } from '@ogygia/core/contract';
import { ogygia } from '../dist/vite/index.js';

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

type Manifest = {
	region_name: Record<string, string>;
	region_url: Record<string, string>;
	load_server_regions(): Promise<{ regions: Record<string, () => Promise<unknown>> }>;
};

test('a deferred region in a library host the scan never saw is in the built server manifest, with its loader', async () => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-late-region-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	write('src/routes/+layout.ts', 'export const csr = false;\n');
	write('src/routes/+page.svelte', '<h1>page</h1>\n');
	// the handle's import of the manifest comes first; the library host is reached later
	write(
		'src/entry.ts',
		dedent`
			export * as manifest from 'ogygia:server/server-manifest';
			export const card = () => import('../lib/Card.svelte');
		`
	);
	write(
		'lib/Card.svelte',
		dedent`
			<script>
				import Slow from './Slow.svelte' with { render: 'deferred' };
			</script>
			<Slow />
		`
	);
	write('lib/Slow.svelte', '<p>slow</p>\n');
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');

	const out_dir = path.join(root, 'out');
	await build({
		root,
		logLevel: 'silent',
		configFile: false,
		plugins: [
			// the bundler reaches the library host after it wrote the server regions' loaders
			{
				name: 'late-host',
				enforce: 'pre',
				async load(id) {
					if (id.endsWith('/lib/Card.svelte'))
						await new Promise((resolve) => setTimeout(resolve, 300));
					return null;
				}
			},
			ogygia(),
			svelte({ configFile: false })
		],
		build: {
			ssr: path.join(root, 'src', 'entry.ts'),
			outDir: out_dir,
			minify: false,
			// (Kit's modules: no Kit here, and nothing below runs a region)
			rollupOptions: { external: [/^\$app\//], output: { entryFileNames: 'entry.js' } }
		}
	});

	const { manifest } = (await import(pathToFileURL(path.join(out_dir, 'entry.js')).href)) as {
		manifest: Manifest;
	};
	const ids = Object.keys(manifest.region_name).filter((id) => manifest.region_name[id] === 'Slow');
	expect(ids, 'the late region is named in the manifest').toHaveLength(1);
	const [id] = ids;
	expect(manifest.region_url[id], 'and has its URL').toBeTypeOf('string');
	const { regions } = await manifest.load_server_regions();
	expect(regions[id], 'and its loader').toBeTypeOf('function');
	// (its file is in the output: the loader imports it by its path from the regions' chunk)
	// (vitest's module runner names its own dynamic import in the loader's source)
	const spec = /import(?:__)?\(["']([^"']+)["']\)/.exec(String(regions[id]))?.[1];
	expect(spec, 'the loader imports a file').toBeTypeOf('string');
	const chunks = fs.readdirSync(out_dir, { recursive: true }).map(String);
	expect(chunks.some((f) => f.endsWith(path.basename(spec!)))).toBe(true);
	// (the late path: its own emitted chunk, not the loaders written with the module)
	expect(path.basename(spec!)).toMatch(/^og-server-region/);
});
