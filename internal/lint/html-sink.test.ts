// `ogygia/html-sink` (./plugin.ts, HOLE-TRUST): outside the HTML sink, package source turns no string
// into DOM and makes no VerifiedHtml. Linted for real: a package file in a temporary tree, the
// repository's plugin.
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
	const dir = mkdtempSync(path.join(tmpdir(), 'og-html-sink-'));
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
				rules: { 'ogygia/html-sink': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*html-sink/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const BAD = `type VerifiedHtml = string & { readonly v: true };
declare const el: Element;
declare const s: string;
el.innerHTML = s;
el.outerHTML = s;
el.insertAdjacentHTML('beforeend', s);
document.createRange().createContextualFragment(s);
(el as unknown as { setHTMLUnsafe(h: string): void }).setHTMLUnsafe(s);
new DOMParser().parseFromString(s, 'text/html');
document.write(s);
export const v = s as VerifiedHtml;
export const ok = el.innerHTML.length + el.textContent!.length;
`;

test('package source that turns a string into DOM, or casts to VerifiedHtml, is refused', () => {
	assert.deepEqual(reported('packages/demo/src/bad.ts', BAD), [4, 5, 6, 7, 8, 9, 10, 11]);
});

test('the HTML sink itself, and code outside package source, may', () => {
	assert.deepEqual(reported('packages/core/src/runtime/html-sink.ts', BAD), []);
	assert.deepEqual(reported('packages/demo/test/bad.test.ts', BAD), []);
});
