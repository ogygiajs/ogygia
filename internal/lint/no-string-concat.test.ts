// `ogygia/no-string-concat` (./plugin.ts): a string is built with a template literal, never with
// `+` / `+=`. A `+=` inside a loop body is a string built in pieces: its message says to collect
// the parts in an array and `join()` them once, and it has no fix (a template literal there still
// copies the whole string on every turn). Linted for real: a file in a temporary tree, the
// repository's plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');
const LOOP = /array and `join\(\)`/;
const TEMPLATE = /^Build the string with a template literal/;

type Hit = { line: number; message: string };

/** What the rule reports over `source`, and the file after `--fix`. */
function lint(source: string): { hits: Hit[]; fixed: string } {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-no-string-concat-'));
	try {
		const file = path.join(dir, 'packages/demo/src/build.ts');
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { 'ogygia/no-string-concat': 'error' }
			})
		);
		const run = (args: string[]): string => {
			try {
				return execFileSync(OXLINT, ['-c', config, '--format', 'unix', ...args, file], {
					cwd: dir,
					encoding: 'utf8'
				});
			} catch (e) {
				return String((e as { stdout?: string }).stdout ?? '');
			}
		};
		const hits = [
			...run([]).matchAll(/:(\d+):\d+: (.*) \[Error\/ogygia\(no-string-concat\)\]/g)
		].map((m) => ({ line: Number(m[1]), message: m[2]! }));
		run(['--fix']);
		return { hits, fixed: readFileSync(file, 'utf8') };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('a += inside a for-of body says to collect the parts and join them once, with no fix', () => {
	const source = dedent`
		declare const cards: { name: string }[];
		declare const text: string;
		let all = '';
		for (const c of cards) {
			all += \`\${c.name}\\n\${text}\\n\`;
		}
		export { all };
	`;
	const { hits, fixed } = lint(source);
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.line, 5);
	assert.match(hits[0]!.message, LOOP);
	assert.equal(fixed, source);
});

test('a += in every kind of loop body, and in a forEach or map callback, gets the join message', () => {
	const { hits, fixed } = lint(dedent`
		declare const xs: string[];
		declare const o: Record<string, string>;
		let s = '';
		for (let i = 0; i < xs.length; i++) s += 'a';
		for (const k in o) {
			s += 'b';
		}
		while (s.length < 9) s += 'c';
		do {
			s += 'd';
		} while (s.length < 20);
		xs.forEach((x) => {
			s += \`\${x}!\`;
		});
		xs.map(function (x) {
			s += 'e';
			return x;
		});
		export { s };
	`);
	assert.deepEqual(
		hits.map((h) => h.line),
		[4, 6, 8, 10, 13, 16]
	);
	for (const h of hits) assert.match(h.message, LOOP);
	assert.doesNotMatch(fixed, /s = `/);
});

test('a += outside a loop keeps the template literal message and its fix', () => {
	const { hits, fixed } = lint(dedent`
		declare const name: string;
		let s = 'hi';
		s += \` \${name}\`;
		export { s };
	`);
	assert.equal(hits.length, 1);
	assert.match(hits[0]!.message, TEMPLATE);
	assert.match(fixed, /s = `\$\{s\} \$\{name\}`;/);
});

test('a function inside a loop is its own body: a += in it is not in the loop', () => {
	const { hits } = lint(dedent`
		declare const xs: string[];
		const out: (() => string)[] = [];
		for (const x of xs) {
			out.push(() => {
				let s = x;
				s += '!';
				return s;
			});
		}
		export { out };
	`);
	assert.equal(hits.length, 1);
	assert.match(hits[0]!.message, TEMPLATE);
});

test('a + chain inside a loop keeps the template literal message', () => {
	const { hits } = lint(dedent`
		declare const xs: string[];
		const out: string[] = [];
		for (const x of xs) out.push(x + '!');
		export { out };
	`);
	assert.equal(hits.length, 1);
	assert.match(hits[0]!.message, TEMPLATE);
});

test('number += inside a loop is arithmetic, not reported', () => {
	const { hits } = lint(dedent`
		declare const xs: number[];
		let n = 0;
		for (const x of xs) n += x;
		export { n };
	`);
	assert.deepEqual(hits, []);
});
