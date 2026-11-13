import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cheap_plan, format_lint_inputs } from './ci-plan-inputs.ts';

const TREE = [
	'100644 blob aaa\t.oxlintrc.json',
	'040000 tree bbb\t.changeset',
	'040000 tree ccc\tapps',
	'040000 tree ddd\tinternal',
	'040000 tree eee\tpackages',
	'100644 blob fff\tpackage.json'
];

test('format and lint are remembered under every input they read, internal/ included (#1531)', () => {
	assert.deepEqual(format_lint_inputs(TREE), [
		'100644 blob aaa\t.oxlintrc.json',
		'040000 tree ddd\tinternal',
		'100644 blob fff\tpackage.json'
	]);
});

test('a change only under internal/ changes what format and lint were remembered under (#1531)', () => {
	const after = TREE.map((l) => l.replace('ddd\tinternal', 'ddd2\tinternal'));
	assert.notDeepEqual(format_lint_inputs(after), format_lint_inputs(TREE));
});

test('a PR of only Markdown, changesets or other workflows still runs format and lint (#1531)', () => {
	assert.equal(cheap_plan(['README.md', '.changeset/x.md', '.github/workflows/dst.yml']), 'check');
	assert.equal(cheap_plan(['internal/sim/src/gen.ts']), 'all');
	assert.equal(cheap_plan(['README.md', 'packages/core/src/x.ts']), 'all');
	assert.equal(cheap_plan(['.github/scripts/ci-plan.ts']), 'all');
});
