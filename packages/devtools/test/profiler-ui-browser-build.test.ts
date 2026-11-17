/**
 * The profiler's pages wake islands in the browser, so everything those islands import is built by
 * the browser leg. An app that turns the profiler on (`devtools({ profiler: true })`) and builds
 * for production builds that graph, and the build refuses any server module in it.
 */
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from '@ogygia/compiler/vite';

const PROFILER = fileURLToPath(new URL('../src/profiler', import.meta.url));
const WOKEN_IMPORT = /import\s+\w+\s+from\s+'(\.[^']+\.svelte)'\s+with\s*\{\s*wake\b/g;

/** Every profiler component a profiler page imports as an island: the browser leg's roots. */
function woken_components(): string[] {
	const found = new Set<string>();
	for (const rel of fs.readdirSync(PROFILER, { recursive: true }) as string[]) {
		if (!rel.endsWith('.svelte')) continue;
		const file = path.join(PROFILER, rel);
		for (const m of fs.readFileSync(file, 'utf8').matchAll(WOKEN_IMPORT))
			found.add(path.resolve(path.dirname(file), m[1]));
	}
	return [...found].sort();
}

let root = '';
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = '';
});

it('the browser build of the profiler’s islands imports no server module', async () => {
	const roots = woken_components();
	expect(roots.map((f) => path.basename(f))).toContain('PermalinkGate.svelte');
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-profiler-browser-')));
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ name: 'app', type: 'module' })
	);
	fs.writeFileSync(
		path.join(root, 'entry.js'),
		roots.map((f, i) => `export { default as C${i} } from ${JSON.stringify(f)};`).join('\n')
	);
	const svelte_dir = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
	fs.mkdirSync(path.join(root, 'node_modules'));
	fs.symlinkSync(svelte_dir, path.join(root, 'node_modules', 'svelte'), 'dir');
	await expect(
		build({
			root,
			logLevel: 'silent',
			configFile: false,
			plugins: [ogygia(), svelte({ configFile: false })],
			build: {
				write: false,
				minify: false,
				rolldownOptions: { input: path.join(root, 'entry.js'), external: [/^\$app\//] }
			}
		})
	).resolves.toBeDefined();
}, 120_000);
