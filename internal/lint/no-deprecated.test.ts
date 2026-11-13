// `typescript/no-deprecated` (type-aware, the root .oxlintrc.json): a use of anything marked
// `@deprecated`, ours or a dependency's, fails `pnpm lint`, in source, tests and config files alike.
// Linted for real with the repository's own config, on files in a temporary tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');
const CONFIG = path.join(ROOT, '.oxlintrc.json');

/** The lines `typescript/no-deprecated` reports in `source`, saved as `name`. */
function reported(name: string, source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-no-deprecated-'));
	try {
		const file = path.join(dir, name);
		writeFileSync(file, source);
		let out = '';
		try {
			out = execFileSync(OXLINT, ['-c', CONFIG, '--format', 'unix', file], {
				cwd: ROOT,
				encoding: 'utf8'
			});
		} catch (e) {
			out = String((e as { stdout?: string }).stdout ?? '');
		}
		return [...out.matchAll(/:(\d+):\d+: .*no-deprecated/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const OURS = [
	'/** @deprecated Use `now` instead. */',
	'export function then(): number {',
	'\treturn 1;',
	'}',
	'export function now(): number {',
	'\treturn 2;',
	'}',
	'export const a = then();',
	'export const b = now();',
	''
].join('\n');

test('a use of our own @deprecated function is reported, and the current one is not', () => {
	assert.deepEqual(reported('module.ts', OURS), [8]);
});

test('a deprecated platform API is reported (a dependency’s types, not ours)', () => {
	assert.deepEqual(reported('module.ts', "export const s = escape('x');\n"), [1]);
});

test('a config file is linted too', () => {
	assert.deepEqual(reported('tsdown.config.ts', "export default { x: escape('x') };\n"), [1]);
});

test('a waiver names the rule and its reason, and silences only its line', () => {
	const source = [
		'// oxlint-disable-next-line typescript/no-deprecated -- the test needs the old global',
		"export const s = escape('x');",
		"export const t = escape('y');",
		''
	].join('\n');
	assert.deepEqual(reported('module.ts', source), [3]);
});
