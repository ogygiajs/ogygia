// node --test internal/lint/structured-comments.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const oxlint = join(root, 'node_modules/.bin/oxlint');

/** The lines `ogygia/structured-comments` reports in each file of a fake repository. */
function findings(files: Record<string, string>): Record<string, number[]> {
	const dir = mkdtempSync(join(tmpdir(), 'structured-comments-'));
	try {
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, path)), { recursive: true });
			writeFileSync(join(dir, path), text);
		}
		writeFileSync(
			join(dir, 'oxlintrc.json'),
			JSON.stringify({
				plugins: [],
				categories: {},
				jsPlugins: [join(here, 'plugin.ts')],
				rules: { 'ogygia/structured-comments': 'error' }
			})
		);
		let out: string;
		try {
			out = execFileSync(oxlint, ['-c', 'oxlintrc.json', '-f', 'json', 'packages'], {
				cwd: dir,
				encoding: 'utf8'
			});
		} catch (e) {
			out = (e as { stdout: string }).stdout;
		}
		const report = JSON.parse(out) as {
			diagnostics: { filename: string; labels: { span: { line: number } }[] }[];
		};
		const by: Record<string, number[]> = {};
		for (const d of report.diagnostics) {
			const name = d.filename.replace(/^.*?packages\//, 'packages/');
			(by[name] ??= []).push(d.labels[0].span.line);
		}
		for (const lines of Object.values(by)) lines.sort((a, b) => a - b);
		return by;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const A = 'packages/demo/src/a.ts';

test('JSDoc on an export or a member of an exported type passes; JSDoc on a local is reported', () => {
	const src = [
		'/** exported */', // 1
		'export function f() {', // 2
		'\tconst o = {', // 3
		'\t\t/** a property inside a body */', // 4
		'\t\tx: 1 };', // 5
		'\treturn o; }', // 6
		'export interface Options {', // 7
		'\t/** a member */', // 8
		'\tsize: number;', // 9
		'}', // 10
		'/** local */', // 11
		'function g() {}', // 12
		'/** exported later */', // 13
		'const h = 1;', // 14
		'export { h };', // 15
		'export class C {', // 16
		'\t/** a class member */', // 17
		'\tm() {}', // 18
		'}', // 19
		'g();' // 20
	].join('\n');
	assert.deepEqual(findings({ [A]: src }), { [A]: [4, 11] });
});

test('free comments and block comments are reported; tool directives pass', () => {
	const src = [
		'// narration', // 1
		'export const a = /* @__PURE__ */ Object.freeze({});', // 2
		'/* a block */', // 3
		'// oxlint-disable-next-line no-eval -- the test runs a string on purpose', // 4
		'export const b = eval("1");', // 5
		'// @ts-expect-error -- the shape is wrong on purpose', // 6
		'export const c: number = "x";' // 7
	].join('\n');
	assert.deepEqual(findings({ [A]: src }), { [A]: [1, 3] });
});

test('a JSDoc that is only a type (`@type {…}`, `@satisfies {…}`) passes anywhere; prose beside it does not', () => {
	const src = [
		'/** @type {number} */', // 1
		'let a = 1;', // 2
		'/** @satisfies {Record<string, number>} */', // 3
		'const b = { x: 1 };', // 4
		'/** @type {number} the count */', // 5
		'let c = a + b.x;', // 6
		'console.log(c);' // 7
	].join('\n');
	assert.deepEqual(findings({ [A]: src }), { [A]: [5] });
});

test("a component's props type is its export: JSDoc on it and its members passes", () => {
	const named = [
		'<script lang="ts">', // 1
		'\t/** the props */', // 2
		'\ttype Props = {', // 3
		'\t\t/** a prop */', // 4
		'\t\tsize: number;', // 5
		'\t};', // 6
		'\ttype Other = {', // 7
		'\t\t/** not the props */', // 8
		'\t\tx: number;', // 9
		'\t};', // 10
		'\tconst props: Props = $props();', // 11
		'\tconst o: Other = { x: props.size };', // 12
		'</script>', // 13
		'<p>{o.x}</p>' // 14
	].join('\n');
	const inline = [
		'<script lang="ts">', // 1
		'\tlet {', // 2
		'\t\tsize', // 3
		'\t}: {', // 4
		'\t\t/** a prop */', // 5
		'\t\tsize: number;', // 6
		'\t} = $props();', // 7
		'\t/** local */', // 8
		'\tconst twice = size * 2;', // 9
		'</script>', // 10
		'<p>{twice}</p>' // 11
	].join('\n');
	const N = 'packages/demo/src/N.svelte';
	const I = 'packages/demo/src/I.svelte';
	assert.deepEqual(findings({ [N]: named, [I]: inline }), { [N]: [8], [I]: [8] });
});

test("a bin's #! line passes; the comments after it are read as usual", () => {
	const src = ['#!/usr/bin/env node', '// narration', 'export const a = 1;'].join('\n');
	assert.deepEqual(findings({ [A]: src }), { [A]: [2] });
});

test('a directive with no reason is reported', () => {
	const src = ['// oxlint-disable-next-line no-eval', 'export const b = eval("1");'].join('\n');
	assert.deepEqual(findings({ [A]: src }), { [A]: [1] });
});

test('a @why passes only above its statement and when its test exists', () => {
	const src = [
		'// @why Safari fires it twice (test: test/a.test.ts › fires once)', // 1
		'export const a = 1;', // 2
		'// @why Safari fires it twice (test: test/a.test.ts › no such test)', // 3
		'export const b = 1;', // 4
		'// @why no test named', // 5
		'export const c = 1;', // 6
		'// @why Safari fires it twice (test: test/a.test.ts › fires once)', // 7
		'', // 8
		'export const d = 1;', // 9
		'export const e = 1; // @why Safari fires it twice (test: test/a.test.ts › fires once)', // 10
		'export const f = 1;' // 11
	].join('\n');
	const files = {
		[A]: src,
		'packages/demo/test/a.test.ts': "test('fires once', () => {});\n"
	};
	assert.deepEqual(findings(files), { [A]: [3, 5, 7, 10] });
});

test('a @packageDocumentation block passes at the top of a file; anywhere else it is reported', () => {
	const top = [
		'/**', // 1
		' * What this entry holds.', // 2
		' *', // 3
		' * @packageDocumentation', // 4
		' */', // 5
		"import { x } from './x.ts';", // 6
		'export { x };' // 7
	].join('\n');
	const later = [
		"import { x } from './x.ts';", // 1
		'/**', // 2
		' * @packageDocumentation', // 3
		' */', // 4
		'x();' // 5
	].join('\n');
	const second = [
		'// first', // 1
		'/** @packageDocumentation */', // 2
		"import { y } from './y.ts';", // 3
		'y();' // 4
	].join('\n');
	const B = 'packages/demo/src/b.ts';
	const C = 'packages/demo/src/c.ts';
	assert.deepEqual(findings({ [A]: top, [B]: later, [C]: second }), {
		[B]: [2],
		[C]: [1, 2]
	});
});

test('an `// ok: <reason>` note passes, as the no-silent-failures rules ask for it; a bare `ok:` is reported', () => {
	const src = [
		'export async function f(p: Promise<void>) {', // 1
		'\tp.catch(() => {}); // ok: the caller reports it', // 2
		'\ttry {', // 3
		'\t\tawait p;', // 4
		'\t} catch {', // 5
		'\t\t// ok: a second read is fine', // 6
		'\t}', // 7
		'\tp.catch(() => {}); // ok:', // 8
		'}' // 9
	].join('\n');
	assert.deepEqual(findings({ [A]: src }), { [A]: [8] });
});

test('.d.ts files and files outside a package src are not read', () => {
	assert.deepEqual(
		findings({
			'packages/demo/src/b.d.ts': '// ambient\ndeclare const x: number;\n',
			'packages/demo/test/c.ts': '// a test comment\nexport {};\n'
		}),
		{}
	);
});
