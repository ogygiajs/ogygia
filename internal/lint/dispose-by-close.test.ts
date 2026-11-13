// `ogygia/dispose-by-close` (./plugin.ts): package source never calls `x[Symbol.dispose]()` or
// `x[Symbol.asyncDispose]()`. WebKit has neither symbol, so the call is `x[undefined]()` and throws
// (#1144: the testing engine lost a session across a full load). `close()` works everywhere.
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
	const dir = mkdtempSync(path.join(tmpdir(), 'og-dispose-by-close-'));
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
				rules: { 'ogygia/dispose-by-close': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*dispose-by-close/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SOURCE = `declare const s: { close(): void; [Symbol.dispose](): void; [Symbol.asyncDispose](): Promise<void> };
s[Symbol.dispose]();
await s[Symbol.asyncDispose]();
s?.[Symbol.dispose]?.();
s.close();
export class Owner {
	[Symbol.dispose](): void {}
}
export const has = typeof s[Symbol.dispose] === 'function';
`;

test('a call through Symbol.dispose or Symbol.asyncDispose is refused', () => {
	assert.deepEqual(reported('packages/demo/src/owner.ts', SOURCE), [2, 3, 4]);
});
