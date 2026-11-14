/**
 * PLAIN-NODE IMPORTS. What each of the package's entries needs to load, imported from the built
 * dist by plain Node with no loader: nothing (`plain`), Vite serving ogygia's `ogygia:*` modules
 * (`vite`), or a Svelte compiler for the `.svelte` components it imports (`svelte`). Scripts,
 * Playwright specs and Node endpoints import the `plain` ones, so an entry that starts to need more
 * fails here, and so does one that needs less than this table says. The snippet codec is checked the
 * same way: it never imports a renderer (snippet-render.ts does).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
	publishConfig: { exports: Record<string, { default?: string }> };
};

type Needs = 'plain' | 'vite' | 'svelte';

const NEEDS: Readonly<Record<string, Needs>> = {
	'.': 'svelte',
	'./contract': 'plain',
	'./runtime': 'vite',
	'./hooks': 'svelte',
	'./app': 'plain',
	'./internal': 'svelte',
	'./internal/server': 'vite',
	'./internal/instruments': 'plain',
	'./internal/messages': 'plain',
	'./internal/register': 'plain',
	'./internal/reconcile': 'plain',
	'./server': 'svelte',
	'./plugin': 'svelte',
	'./plugin/utils': 'plain',
	'./plugin/css': 'vite',
	'./plugin/testing': 'plain',
	'./plugin/client': 'plain',
	'./events': 'plain'
};

/** The snippet codec's modules, which every wire format imports. */
const CODEC: readonly string[] = [
	'dist/region-snippet.js',
	'dist/transport.js',
	'dist/live-transport.js',
	'dist/server/props-wire.js',
	'dist/server/region-props.js'
];

const IMPORT_RE =
	/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

/** Every specifier `file` reaches through its static imports, following the relative ones. */
function reached(file: string, seen = new Set<string>(), out = new Set<string>()): Set<string> {
	if (seen.has(file)) return out;
	seen.add(file);
	for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
		const spec = (m[1] ?? m[2])!;
		out.add(spec);
		if (spec.startsWith('.') && !spec.endsWith('.svelte'))
			reached(path.resolve(path.dirname(file), spec), seen, out);
	}
	return out;
}

/** What `file` needs to load, or what Node said when it failed for another reason. The heaviest
 *  need its import graph holds decides, so the answer never depends on which import Node fails on
 *  first (that order differs between Node versions). */
function needs(file: string): string {
	const specs = [...reached(path.join(ROOT, file))];
	if (specs.some((s) => s.endsWith('.svelte'))) return 'svelte';
	if (specs.some((s) => s.startsWith('ogygia:') || s.startsWith('$app/'))) return 'vite';
	const res = spawnSync(
		process.execPath,
		['--input-type=module', '-e', `await import(${JSON.stringify(path.join(ROOT, file))})`],
		{ encoding: 'utf8', cwd: ROOT, env: { ...process.env, NODE_OPTIONS: '' } }
	);
	if (res.status === 0) return 'plain';
	if (/ERR_UNKNOWN_FILE_EXTENSION[^\n]*\.svelte/.test(res.stderr)) return 'svelte';
	if (/'ogygia:'|Cannot find package '\$app'/.test(res.stderr)) return 'vite';
	return res.stderr.slice(0, 600);
}

describe('the built entries, imported by plain Node', () => {
	it('the table names every entry the package publishes', () => {
		const published = Object.keys(pkg.publishConfig.exports).filter(
			(k) => pkg.publishConfig.exports[k]!.default
		);
		expect(Object.keys(NEEDS).sort()).toEqual(published.sort());
	});

	it.each(Object.entries(NEEDS))('%s needs %s', (entry, need) => {
		const file = pkg.publishConfig.exports[entry]!.default!;
		expect(fs.existsSync(path.join(ROOT, file)), `${file} is not built: run pnpm build:lib`).toBe(
			true
		);
		expect(needs(file)).toBe(need);
	});

	it.each(CODEC)('the snippet codec module %s loads in plain Node', (file) => {
		expect(needs(file)).toBe('plain');
	});
});
