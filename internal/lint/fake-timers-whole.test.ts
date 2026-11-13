// `ogygia/fake-timers-whole` (./plugin.ts): a test that fakes some of the four timer calls fakes all
// four. @ogygia/machine ends every timer through `clearInterval` (one handle space with
// `setTimeout`), so a fake `setTimeout` whose `clearInterval` is real is never ended: an old
// state's timer fires later, and a test that needed it ended passes without it (#1709).
// Linted for real: a test file in a temporary tree, the repository's plugin.
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
	const dir = mkdtempSync(path.join(tmpdir(), 'og-fake-timers-whole-'));
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
				rules: { 'ogygia/fake-timers-whole': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*fake-timers-whole/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SOURCE = `import { vi } from 'vitest';
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
vi.useFakeTimers({ toFake: ['setInterval'] });
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
vi.useFakeTimers({ toFake: ['Date'] });
vi.useFakeTimers();
const TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;
vi.useFakeTimers({ toFake: [...TIMERS] });
`;

test('a fake timer list with some of the four timer calls and not all of them is refused', () => {
	assert.deepEqual(reported('packages/demo/test/timers.test.ts', SOURCE), [2, 3, 4]);
});
