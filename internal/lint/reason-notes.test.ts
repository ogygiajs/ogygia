// A REASON NOTE NAMES ONE STATEMENT (#1033): `// port-ok: <why>` (`ogygia/ports`) and
// `// hash: <why>` (`ogygia/one-hash`) excuse the code on their own line, or the line below when
// the note stands alone on its line. A note trailing another statement is that statement's: the
// line under it is still checked. Linted for real: a package file in a temporary tree, the
// repository's plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');

/** The lines of `source`, as a core source file, that `rule` reports. */
function reported(rule: string, source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-reason-notes-'));
	try {
		const file = path.join(dir, 'packages/core/src/x.ts');
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { [`ogygia/${rule}`]: 'error' }
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
		return [...out.matchAll(new RegExp(`:(\\d+):\\d+: .*${rule}`, 'g'))].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const PORTS = `export const a = Date.now(); // port-ok: stored for the next load
export const elapsed = Date.now() - a;
// port-ok: a note alone on its line names the line below
export const b = Date.now();
export const c = Date.now(); // port-ok: its own line
export const d = Date.now();
`;

test('ogygia/ports: a trailing note excuses its own line, not the line below', () => {
	assert.deepEqual(reported('ports', PORTS), [2, 6]);
});

const HASH = `export const a = 0x811c9dc5; // hash: a seeded copy
export const b = 0x811c9dc5;
// hash: one over bytes
export const c = 0x811c9dc5;
`;

test('ogygia/one-hash: a trailing note excuses its own line, not the line below', () => {
	assert.deepEqual(reported('one-hash', HASH), [2]);
});
