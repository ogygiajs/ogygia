import assert from 'node:assert/strict';
import { test } from 'node:test';
import { has_label, is_batched, is_stacked, labels_for } from './ci-stack.ts';

test('a PR into main, latest or an lts line is not stacked; a PR into another PR branch is', () => {
	assert.equal(is_stacked('main'), false);
	assert.equal(is_stacked('latest'), false);
	assert.equal(is_stacked('lts-0.12'), false);
	assert.equal(is_stacked('feat/clock-core'), true);
});

test('a PR into an lts line earns the path labels, like before stacks were gated', () => {
	assert.deepEqual(labels_for('lts-0.12', ['packages/router/src/x.ts']), ['ci:engines']);
	assert.deepEqual(labels_for('main', ['README.md']), ['ci:bench', 'ci:preview']);
	assert.deepEqual(labels_for('feat/x', ['packages/router/src/x.ts']), []);
});

test('a stacked PR runs an opt-in set its author added by hand', () => {
	assert.equal(has_label('ci:engines', 'feat/x', ['ci:engines'], []), true);
	assert.equal(has_label('ci:coverage', 'feat/x', ['ci:coverage'], []), true);
	assert.equal(has_label('ci:bench', 'feat/x', [], []), false);
	assert.equal(has_label('ci:bench', 'feat/x', ['ci:full'], []), true);
});

test('a PR into main runs what it carries or earns', () => {
	assert.equal(has_label('ci:bench', 'main', [], ['ci:bench']), true);
	assert.equal(has_label('ci:engines', 'main', [], ['ci:bench']), false);
});

test('a batched PR runs no opt-in set, not even with ci:full: its batch runs them', () => {
	assert.equal(is_batched(['batched']), true);
	assert.equal(is_batched(['ci:bench']), false);
	assert.equal(has_label('ci:bench', 'main', ['batched'], ['ci:bench']), false);
	assert.equal(has_label('ci:engines', 'main', ['batched', 'ci:full'], []), false);
	assert.equal(has_label('ci:preview', 'feat/x', ['batched', 'ci:preview'], []), false);
});
