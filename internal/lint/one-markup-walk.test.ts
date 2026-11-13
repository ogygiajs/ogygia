// `ogygia/one-markup-walk` (./plugin.ts, #1370): package source reads HTML through core's tag walk.
// A regex or an indexOf over tags or attributes fails, unless it says why with `// markup-ok:`.
// Linted for real: a file in a temporary tree, the repository's plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');

/** The lines of `source`, as `rel` in a package tree, the rule reports. */
function reported(rel: string, source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-markup-walk-'));
	try {
		const file = path.join(dir, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { 'ogygia/one-markup-walk': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*one-markup-walk/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const BAD = `declare const html: string;
declare const name: string;
const a = /<script\\b[^>]*>/;
const b = /\\sendpoint="([^"]*)"/;
const c = /<([a-z][\\w-]*)/g;
const d = new RegExp(\`<\${name}[^>]*>\`);
const e = html.indexOf('<meta');
const f = html.lastIndexOf('</body>');
const g = html.indexOf('<!--');
const h = html.indexOf(\`</\${name}\`);
`;

const FINE = `declare const html: string;
const a = /[&<>"]/g;
const b = html.indexOf('<');
const c = html.indexOf('>');
const d = html.includes('<ogygia-region');
const e = /^data-[a-z]+$/;
const f = html.replace(/</g, '&lt;');
// markup-ok: a test oracle that must not share the walk's mistakes
const g = /<script\\b[^>]*>/;
const h = html.indexOf('</head>'); // markup-ok: a stated reason
`;

test('a regex or an indexOf over tags or attributes in package source is reported', () => {
	assert.deepEqual(reported('packages/x/src/a.ts', BAD), [3, 4, 5, 6, 7, 8, 9, 10]);
});

test('an escaper, a prefilter, a bare `<`, and a site that says why are not', () => {
	assert.deepEqual(reported('packages/x/src/a.ts', FINE), []);
});

test('the walk itself, the compiler (until its own sweep), and code outside package source are not linted', () => {
	assert.deepEqual(reported('packages/core/src/markup-walk.ts', BAD), []);
	assert.deepEqual(reported('packages/compiler/src/a.ts', BAD), []);
	assert.deepEqual(reported('packages/x/test/a.test.ts', BAD), []);
	assert.deepEqual(reported('internal/html-fuzz/src/a.ts', BAD), []);
});
