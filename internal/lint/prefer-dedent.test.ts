// `ogygia/prefer-dedent` (./plugin.ts): text of several lines is written as its lines, in one
// `dedent` template. A template whose only text is `\n` between its values (`${a}\n${b}\n`) is
// values joined by newlines, not prose: it has no lines of its own to write, and is not reported.
// Linted for real: a package file in a temporary tree, the repository's plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');

/** The lines of `source` the rule reports. */
function reported(source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-prefer-dedent-'));
	try {
		const file = path.join(dir, 'packages/machine/src/text.ts');
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { 'ogygia/prefer-dedent': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*prefer-dedent/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('values joined only by newlines are not prose, and are not reported', () => {
	assert.deepEqual(
		reported(dedent`
			declare const a: string;
			declare const b: string;
			declare const c: { name: string };
			export const two = \`\${a}\\n\${b}\\n\`;
			export const lead = \`\\n\${a}\\n\${b}\`;
			export const gaps = \`\${a}\\n\\n\${b}\\n\\n\${c.name}\`;
			let all = '';
			for (const x of [c]) all = \`\${all}\${x.name}\\n\${a}\\n\`;
			export { all };
		`),
		[]
	);
});

test('prose with newlines between values still reports', () => {
	assert.deepEqual(
		reported(dedent`
			declare const a: string;
			declare const b: string;
			export const said = \`first: \${a}\\nsecond: \${b}\\n\`;
			export const plain = 'one\\ntwo\\nthree';
			export const tail = \`\${a}\\n\${b}\\nend\`;
		`),
		[3, 4, 5]
	);
});
