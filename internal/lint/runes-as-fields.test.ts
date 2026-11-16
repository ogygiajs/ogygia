// `ogygia/runes-as-fields` (./plugin.ts): a class in a .svelte.ts or .svelte file of package source
// declares its $state and $derived values as fields, never inside its constructor.
// Linted for real: a package file in a temporary tree, the repository's plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');

/** The lines of `source`, as `rel` in a package tree, the rule reports. */
function reported(rel: string, source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-runes-as-fields-'));
	try {
		const file = path.join(dir, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { 'ogygia/runes-as-fields': 'error' }
			})
		);
		let out = '';
		try {
			out = execFileSync(OXLINT, ['-c', config, '--format', 'unix', file], {
				cwd: dir,
				encoding: 'utf8'
			});
		} catch (e) {
			out = String((e as { stdout?: string }).stdout ?? '');
		}
		return [...out.matchAll(/:(\d+):\d+: .*runes-as-fields/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SOURCE = `export class Counter {
	readonly #start: number;
	count = $state(0);
	double = $derived(this.count * 2);
	list = $state.raw([] as number[]);
	label = $derived.by(() => String(this.count));
	other: number;
	constructor(start: number) {
		this.#start = start;
		this.other = $state(start);
		this.count = $derived(start);
		const inner = () => $state.raw(1);
		this.list = $derived.by(() => [start]);
	}
	reset(): void {
		const local = $derived(this.#start);
		this.count = local;
	}
}
`;

test('a rune inside a constructor is refused; one in a field or a method is not', () => {
	assert.deepEqual(reported('packages/demo/src/counter.svelte.ts', SOURCE), [10, 11, 12, 13]);
});

test('a plain .ts file and a file outside package source are not linted', () => {
	assert.deepEqual(reported('packages/demo/src/counter.ts', SOURCE), []);
	assert.deepEqual(reported('apps/demo/src/counter.svelte.ts', SOURCE), []);
});
