// node --test internal/lint/structured-comments.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedent } from '../../packages/core/src/contract/dedent.ts';

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
	const src = dedent`
		/** exported */
		export function f() {
			const o = {
				/** a property inside a body */
				x: 1 };
			return o; }
		export interface Options {
			/** a member */
			size: number;
		}
		/** local */
		function g() {}
		/** exported later */
		const h = 1;
		export { h };
		export class C {
			/** a class member */
			m() {}
		}
		g();
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [4, 11] });
});

test('free comments and block comments are reported; tool directives pass', () => {
	const src = dedent`
		// narration
		export const a = /* @__PURE__ */ Object.freeze({});
		/* a block */
		// oxlint-disable-next-line no-eval -- the test runs a string on purpose
		export const b = eval("1");
		// @ts-expect-error -- the shape is wrong on purpose
		export const c: number = "x";
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [1, 3] });
});

test('a JSDoc that is only a type (`@type {…}`, `@satisfies {…}`) passes anywhere; prose beside it does not', () => {
	const src = dedent`
		/** @type {number} */
		let a = 1;
		/** @satisfies {Record<string, number>} */
		const b = { x: 1 };
		/** @type {number} the count */
		let c = a + b.x;
		console.log(c);
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [5] });
});

test("a component's props type is its export: JSDoc on it and its members passes", () => {
	const named = dedent`
		<script lang="ts">
			/** the props */
			type Props = {
				/** a prop */
				size: number;
			};
			type Other = {
				/** not the props */
				x: number;
			};
			const props: Props = $props();
			const o: Other = { x: props.size };
		</script>
		<p>{o.x}</p>
	`;
	const inline = dedent`
		<script lang="ts">
			let {
				size
			}: {
				/** a prop */
				size: number;
			} = $props();
			/** local */
			const twice = size * 2;
		</script>
		<p>{twice}</p>
	`;
	const N = 'packages/demo/src/N.svelte';
	const I = 'packages/demo/src/I.svelte';
	assert.deepEqual(findings({ [N]: named, [I]: inline }), { [N]: [8], [I]: [8] });
});

test("a bin's #! line passes; the comments after it are read as usual", () => {
	const src = dedent`
		#!/usr/bin/env node
		// narration
		export const a = 1;
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [2] });
});

test('a directive with no reason is reported', () => {
	const src = dedent`
		// oxlint-disable-next-line no-eval
		export const b = eval("1");
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [1] });
});

test('a @why passes only above its statement and when its test exists', () => {
	const src = dedent`
		// @why Safari fires it twice (test: test/a.test.ts › fires once)
		export const a = 1;
		// @why Safari fires it twice (test: test/a.test.ts › no such test)
		export const b = 1;
		// @why no test named
		export const c = 1;
		// @why Safari fires it twice (test: test/a.test.ts › fires once)

		export const d = 1;
		export const e = 1; // @why Safari fires it twice (test: test/a.test.ts › fires once)
		export const f = 1;
	`;
	const files = {
		[A]: src,
		'packages/demo/test/a.test.ts': "test('fires once', () => {});\n"
	};
	assert.deepEqual(findings(files), { [A]: [3, 5, 7, 10] });
});

test('a @packageDocumentation block passes at the top of a file; anywhere else it is reported', () => {
	const top = dedent`
		/**
		 * What this entry holds.
		 *
		 * @packageDocumentation
		 */
		import { x } from './x.ts';
		export { x };
	`;
	const later = dedent`
		import { x } from './x.ts';
		/**
		 * @packageDocumentation
		 */
		x();
	`;
	const second = dedent`
		// first
		/** @packageDocumentation */
		import { y } from './y.ts';
		y();
	`;
	const B = 'packages/demo/src/b.ts';
	const C = 'packages/demo/src/c.ts';
	assert.deepEqual(findings({ [A]: top, [B]: later, [C]: second }), {
		[B]: [2],
		[C]: [1, 2]
	});
});

test('an `// ok: <reason>` note passes, as the no-silent-failures rules ask for it; a bare `ok:` is reported', () => {
	// (line 8 is the bare `ok:`)
	const src = dedent`
		export async function f(p: Promise<void>) {
			p.catch(() => {}); // ok: the caller reports it
			try {
				await p;
			} catch {
				// ok: a second read is fine
			}
			p.catch(() => {}); // ok:
		}
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [8] });
});

test('an old `// ok: <reason>` mark is no shape of its own; the directive with a reason is', () => {
	const src = dedent`
		export async function f(p: Promise<void>) {
			p.catch(() => {}); // ok: the caller reports it
			// oxlint-disable-next-line ogygia/no-silent-failures -- the caller reports it
			p.catch(() => {});
		}
	`;
	assert.deepEqual(findings({ [A]: src }), { [A]: [2] });
});

test('.d.ts files and files outside a package src are not read', () => {
	assert.deepEqual(
		findings({
			'packages/demo/src/b.d.ts': `${dedent`
				// ambient
				declare const x: number;
			`}\n`,
			'packages/demo/test/c.ts': `${dedent`
				// a test comment
				export {};
			`}\n`
		}),
		{}
	);
});
