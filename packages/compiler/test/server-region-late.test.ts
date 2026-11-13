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
			export { default as Card } from '../lib/Card.svelte';
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
		plugins: [ogygia(), svelte({ configFile: false })],
		build: {
			ssr: path.join(root, 'src', 'entry.ts'),
			outDir: out_dir,
			minify: false,
			rollupOptions: { output: { entryFileNames: 'entry.js' } }
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
	await expect(regions[id]()).resolves.toBeTypeOf('object');
});
