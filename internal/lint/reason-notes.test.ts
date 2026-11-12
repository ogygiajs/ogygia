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

const VOIDS = `declare const p: () => Promise<void>;
declare const s: { send?: () => Promise<void> } | undefined;
void p();
void s?.send?.();
void (p() as Promise<void>);
void p(); // ok: a trailing note is its own line's
void p();
// ok: a note alone on its line names the line below
void p();
void p().catch((e: unknown) => console.error(e));
export const awaited = async () => void (await p());
`;

test('ogygia/no-silent-failures: every void call needs an ok note, an optional call and a cast too', () => {
	assert.deepEqual(reported('no-silent-failures', VOIDS), [3, 4, 5, 7]);
});

const FALLBACKS = `declare const p: () => Promise<string>;
declare const use: (x: unknown) => void;
export function a() { try { return p(); } catch { return null; } }
export function b() { try { return p(); } catch { return ''; } }
export function c(xs: string[]) { for (const x of xs) { try { use(x); } catch { continue; } } }
export function d() { let v = 1; try { v = 2; } catch { v = 0; } return v; }
export const e = () => p().catch(() => '');
export const f = () => p().catch(() => []);
export const g = () => p().then(String, () => { return false; });
export function h() { try { return p(); } catch (err) { return String(err); } }
export function i() { try { return p(); } catch { return null; } } // ok: a missing value is the answer
export const j = () => p().catch((err: unknown) => { use(err); return ''; });
export function k() { try { return p(); } catch { use(1); return null; } }
`;

test('ogygia/no-silent-failures: a catch that only falls back (a value, a continue) says why (#1286)', () => {
	assert.deepEqual(reported('no-silent-failures', FALLBACKS), [3, 4, 5, 6, 7, 8, 9]);
});
