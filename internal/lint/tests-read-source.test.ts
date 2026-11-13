// `ogygia/tests-read-source` (./plugin.ts, #1589): a package test imports the source, not dist/.
// Linted for real: a file in a temporary tree, the repository's plugin.
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
	const dir = mkdtempSync(path.join(tmpdir(), 'og-tests-read-source-'));
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
				rules: { 'ogygia/tests-read-source': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*tests-read-source/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const BUILT = `import { a } from '../dist/compiler/index.js';
export { b } from '../dist/b.js';
export * from '../../core/dist/c.js';
const d = await import('../../core/dist/runtime/d.js');
const e = new URL('../dist/', import.meta.url);
const f = await import(\`../dist/\${'f'}.js\`);
`;

const SOURCE = `import { a } from '../src/compiler/index.ts';
import { b } from '@scope/lib/dist/b.js';
import { c } from './_helpers/distance.ts';
const d = await import('../../core/src/runtime/d.ts');
const e = new URL('../src/', import.meta.url);
const f = '/app/node_modules/lib/dist/f.js';
const g = new URL('../dist/', 'file:///elsewhere/');
`;

test('a package test that imports dist/ is named on each line', () => {
	assert.deepEqual(reported('packages/pkg/test/a.test.ts', BUILT), [1, 2, 3, 4, 5, 6]);
});

test('a test that imports the source, a dependency or a dist-like path as data is fine', () => {
	assert.deepEqual(reported('packages/pkg/test/a.test.ts', SOURCE), []);
});

test('package source and files outside a package test tree are not its business', () => {
	assert.deepEqual(reported('packages/pkg/src/a.ts', BUILT), []);
	assert.deepEqual(reported('apps/site/test/a.test.ts', BUILT), []);
});

test('a test in a nested folder of a package test tree is held too', () => {
	assert.deepEqual(reported('packages/pkg/test/deep/a.test.ts', BUILT), [1, 2, 3, 4, 5, 6]);
});
