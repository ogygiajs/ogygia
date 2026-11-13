// node --test internal/checks/new-comments.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';
import { added_lines, new_comment_findings } from './new-comments.ts';

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A fake repository: `before` committed as the base, then `after` written over it and committed.
 *  Each file's text gets its final newline here, so a line added at the end is the only change. */
function repo(before: Record<string, string>, after: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), 'new-comments-'));
	const write = (files: Record<string, string>) => {
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, path)), { recursive: true });
			writeFileSync(join(dir, path), `${text}\n`);
		}
	};
	git(dir, 'init', '-q');
	git(dir, 'config', 'user.email', 'ci@example.com');
	git(dir, 'config', 'user.name', 'ci');
	write(before);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-qm', 'base');
	const base = git(dir, 'rev-parse', 'HEAD');
	write(after);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-qm', 'change');
	return { dir, base, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const A = 'packages/demo/src/a.ts';
const ONE = 'export const a = 1;';

test('the added lines are read from the diff against the base, nothing else', () => {
	const before = dedent`
		export const a = 1;
		export const b = 2;
	`;
	const after = dedent`
		export const a = 1;
		export const x = 0;
		export const b = 2;
		export const y = 3;
	`;
	const r = repo({ [A]: before }, { [A]: after });
	try {
		assert.deepEqual([...(added_lines(r.dir, r.base).get(A) ?? [])], [2, 4]);
	} finally {
		r.done();
	}
});

test('an added unstructured comment fails the gate', () => {
	const after = dedent`
		export const a = 1;
		// narration about b
		export const b = 2;
	`;
	const r = repo({ [A]: ONE }, { [A]: after });
	try {
		assert.deepEqual(
			new_comment_findings(r.dir, r.base).map((f) => `${f.file}:${f.line}`),
			[`${A}:2`]
		);
	} finally {
		r.done();
	}
});

test('an old unstructured comment the change does not touch passes', () => {
	const before = dedent`
		// an old narration
		export const a = 1;
	`;
	const after = dedent`
		// an old narration
		export const a = 1;
		export const b = 2;
	`;
	const r = repo({ [A]: before }, { [A]: after });
	try {
		assert.deepEqual(new_comment_findings(r.dir, r.base), []);
	} finally {
		r.done();
	}
});

test('an added @why with its test, and JSDoc on an export, pass', () => {
	const after = dedent`
		export const a = 1;
		/** What b is, for its readers. */
		export const b = 2;
		// @why Safari fires it twice (test: test/a.test.ts › fires once)
		export const c = 3;
	`;
	const r = repo(
		{ [A]: ONE, 'packages/demo/test/a.test.ts': "test('fires once', () => {});" },
		{ [A]: after }
	);
	try {
		assert.deepEqual(new_comment_findings(r.dir, r.base), []);
	} finally {
		r.done();
	}
});

test('an added comment in a .svelte script is read too; files outside packages/*/src are not', () => {
	const svelte = dedent`
		<script lang="ts">
			let { size }: { size: number } = $props();
			// narration in a component
			const twice = size * 2;
		</script>
		<p>{twice}</p>
	`;
	const in_test = dedent`
		// narration in a test file
		export const t = 1;
	`;
	const N = 'packages/demo/src/N.svelte';
	const T = 'packages/demo/test/t.ts';
	const r = repo({ [N]: '<p>hi</p>', [T]: ONE }, { [N]: svelte, [T]: in_test });
	try {
		assert.deepEqual(
			new_comment_findings(r.dir, r.base).map((f) => `${f.file}:${f.line}`),
			[`${N}:3`]
		);
	} finally {
		r.done();
	}
});
