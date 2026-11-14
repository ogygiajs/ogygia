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
	'./hooks': 'vite',
	'./app': 'plain',
	'./internal': 'vite',
	'./internal/server': 'vite',
	'./internal/instruments': 'plain',
	'./internal/messages': 'plain',
	'./internal/register': 'plain',
	'./internal/reconcile': 'plain',
	'./server': 'vite',
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

/** What `file` needs to load, or what Node said when it failed for another reason. */
function needs(file: string): string {
	const res = spawnSync(
		process.execPath,
		['--input-type=module', '-e', `await import(${JSON.stringify(path.join(ROOT, file))})`],
		{ encoding: 'utf8', cwd: ROOT, env: { ...process.env, NODE_OPTIONS: '' } }
	);
	if (res.status === 0) return 'plain';
	if (/ERR_UNSUPPORTED_ESM_URL_SCHEME[\s\S]*'ogygia:'|Received protocol 'ogygia:'/.test(res.stderr))
		return 'vite';
	if (/ERR_UNKNOWN_FILE_EXTENSION[^\n]*\.svelte/.test(res.stderr)) return 'svelte';
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
