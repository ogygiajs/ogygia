/**
 * CANARY (#1721): every Svelte entry the compiler names by module id resolves in the installed
 * Svelte's exports map, to a file that is there. Svelte can move or split its internal entries.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SVELTE_DEV_ISLAND_ENTRIES } from '../../src/vite/svelte-entries.ts';
import { broke, type Internal } from '../../../core/test/canary/upstream.ts';

const ENTRIES: Internal = {
	upstream: "Svelte's package entries (`svelte/internal/client` among them)",
	used_by: [
		'packages/compiler/src/vite/svelte-entries.ts',
		'packages/compiler/src/vite/index.ts (the dev islands pre-bundle)'
	],
	issue: 1721
};

const root = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));
const exports = (
	JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
		exports: Record<string, unknown>;
	}
).exports;

/** Every file a conditional export names, however deep its conditions nest. */
function targets(entry: unknown): string[] {
	if (typeof entry === 'string') return [entry];
	if (entry && typeof entry === 'object') return Object.values(entry).flatMap(targets);
	return [];
}

describe("the Svelte entries the compiler names, in the installed Svelte's exports", () => {
	it.each(SVELTE_DEV_ISLAND_ENTRIES)('%s', (id) => {
		const key = id === 'svelte' ? '.' : `./${id.slice('svelte/'.length)}`;
		expect(key in exports, broke(ENTRIES, `\`${id}\` is no longer in the exports map`)).toBe(true);
		const files = targets(exports[key]).filter((f) => !f.endsWith('.d.ts'));
		expect(files.length, broke(ENTRIES, `\`${id}\` names no file`)).toBeGreaterThan(0);
		for (const f of files)
			expect(
				fs.existsSync(path.join(root, f)),
				broke(ENTRIES, `\`${id}\` names ${f}, which is not there`)
			).toBe(true);
	});
});
