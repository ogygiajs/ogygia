// `ogygia/no-string-concat` (./plugin.ts): a string is built with a template literal, never with
// `+` / `+=`. An append (`s += x`, `s = s + x`, `s = \`${s}x\``) builds a string in pieces. In a
// loop that the string outlives, its message says to collect the parts in an array and `join()`
// them once; elsewhere, to write the string once. Neither has a fix: a fix that appends again
// still copies the whole string. Linted for real: a file in a temporary tree, the repository's
// plugin.
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
const ONCE = /^Build the string once, in one template literal/;

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

test('a += outside a loop says to write the string once, with no fix that appends again', () => {
	const source = dedent`
		declare const name: string;
		let s = 'hi';
		s += \` \${name}\`;
		export { s };
	`;
	const { hits, fixed } = lint(source);
	assert.equal(hits.length, 1);
	assert.match(hits[0]!.message, ONCE);
	assert.equal(fixed, source);
});

test('a string appended to itself with a template literal in a loop gets the join message', () => {
	const source = dedent`
		declare const xs: string[];
		let s = '';
		for (const x of xs) s = \`\${s}\${x}!\`;
		while (s.length < 9) {
			s = \`\${s}
		\`;
		}
		export { s };
	`;
	const { hits, fixed } = lint(source);
	assert.deepEqual(
		hits.map((h) => h.line),
		[3, 5]
	);
	for (const h of hits) assert.match(h.message, LOOP);
	assert.equal(fixed, source);
});

test('a string appended to itself with + in a loop is one report, the join message', () => {
	const source = dedent`
		declare const xs: string[];
		let s = '';
		for (const x of xs) s = s + x + '!';
		export { s };
	`;
	const { hits, fixed } = lint(source);
	assert.equal(hits.length, 1);
	assert.match(hits[0]!.message, LOOP);
	assert.equal(fixed, source);
});

test('a member appended to itself in a forEach callback gets the join message', () => {
	const { hits } = lint(dedent`
		declare const xs: string[];
		const o = { s: '' };
		xs.forEach((x) => {
			o.s = \`\${o.s},\${x}\`;
		});
		export { o };
	`);
	assert.equal(hits.length, 1);
	assert.match(hits[0]!.message, LOOP);
});

test('a string appended to itself outside a loop says to write it once, with no fix', () => {
	const source = dedent`
		declare const a: string;
		declare const b: boolean;
		let s = a;
		if (b) s = \`\${s}!\`;
		let t = a;
		if (b) t = t + '?';
		export { s, t };
	`;
	const { hits, fixed } = lint(source);
	assert.deepEqual(
		hits.map((h) => h.line),
		[4, 6]
	);
	for (const h of hits) assert.match(h.message, ONCE);
	assert.equal(fixed, source);
});

test('a string declared inside the loop body is built per turn, not across turns', () => {
	const { hits } = lint(dedent`
		declare const xs: string[];
		const out: string[] = [];
		for (const x of xs) {
			let s = x;
			if (x) s = \`\${s}!\`;
			out.push(s);
		}
		for (let x of xs) x = \`\${x}?\`;
		export { out };
	`);
	assert.deepEqual(
		hits.map((h) => h.line),
		[5, 8]
	);
	for (const h of hits) assert.match(h.message, ONCE);
});

test('a string declared in a for head and appended in its body is built across turns', () => {
	const { hits } = lint(dedent`
		declare const xs: string[];
		for (let i = 0, s = ''; i < xs.length; i++) s = \`\${s}\${xs[i]}\`;
		const out: string[] = [];
		for (const x of xs) {
			let s = '';
			for (const c of x) s = \`\${s}\${c}\${c}\`;
			out.push(s);
		}
		export { out };
	`);
	assert.deepEqual(
		hits.map((h) => h.line),
		[2, 6]
	);
	for (const h of hits) assert.match(h.message, LOOP);
});

test('a template that holds the string but does not start with it is not an append', () => {
	const { hits } = lint(dedent`
		declare const xs: string[];
		let s = '';
		for (const x of xs) s = \`\${x}\${s}\`;
		let t = '';
		t = \`\${t}\`;
		let n = 0;
		for (const x of xs) n = n + x.length;
		export { s, t, n };
	`);
	assert.deepEqual(hits, []);
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
	assert.match(hits[0]!.message, ONCE);
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
