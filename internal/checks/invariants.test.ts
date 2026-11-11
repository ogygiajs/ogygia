import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { check_invariants, disk_repo, read_sections, type Repo } from './invariants.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

const repo: Repo = {
	has_file: (rel) => rel === 'a/b.test.ts',
	read: () => "it('keeps the thing')",
	rule_codes: () => new Set(['rule_kept']),
	lint_rules: () => new Set(['ogygia/html-sink'])
};

const doc = (line: string) =>
	`# t\n\n## ONE — a thing\n\nsome text\n\n${line}\n\n## Related docs\n\n- x\n`;

test('every invariant in INVARIANTS.md names an enforcer that exists', () => {
	const problems = check_invariants(
		readFileSync(path.join(ROOT, 'internal/notes/INVARIANTS.md'), 'utf8'),
		disk_repo(ROOT)
	);
	assert.deepEqual(problems, []);
});

test('a section with no "Enforced by" line fails', () => {
	assert.deepEqual(check_invariants(doc(''), repo), ['ONE: no "**Enforced by:**" line']);
});

test('an "Enforced by" line that names nothing fails', () => {
	assert.deepEqual(check_invariants(doc('**Enforced by:** later'), repo), [
		'ONE: its "Enforced by" line names nothing'
	]);
});

test('a rule, a lint rule, a file and a test by name that exist pass', () => {
	const line =
		'**Enforced by:** `rule_kept`, `ogygia/html-sink`, `a/b.test.ts`, `a/b.test.ts > keeps the thing`.';
	assert.deepEqual(check_invariants(doc(line), repo), []);
});

test('a rule, lint rule, file or test name that does not exist fails, each by name', () => {
	const line =
		'**Enforced by:** `rule_gone`, `ogygia/gone`, `a/gone.test.ts`, `a/b.test.ts > a gone test`, `words`.';
	assert.deepEqual(check_invariants(doc(line), repo), [
		'ONE: no rule registers `rule_gone`',
		'ONE: `ogygia/gone` is not a lint rule switched on in .oxlintrc.json',
		'ONE: `a/gone.test.ts` does not exist',
		'ONE: `a/b.test.ts` holds no `a gone test`',
		'ONE: `words` names no rule, lint rule or file'
	]);
});

test('"Related docs" is not an invariant', () => {
	assert.deepEqual(
		read_sections(doc('**Enforced by:** `rule_kept`')).map((s) => s.name),
		['ONE']
	);
});
