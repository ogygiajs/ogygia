// The NUL byte check (./nul-bytes.ts): a raw NUL is named by its line, an escaped one is not.
// Run by plain node: `node --test internal/checks/nul-bytes.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';
import { find_nul_bytes, nul_lines } from './nul-bytes.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test('a raw NUL byte is named by its line, once per line', () => {
	const source = ['const a = 1;', 'const k = `k\0${a}\0`;', '\0'].join('\n');
	assert.deepEqual(nul_lines(bytes(source)), [2, 3]);
});

test('the escaped forms are not NUL bytes', () => {
	const source = dedent`
		const k = \`k\\0\${a}\`;
		const u = "\\u0000";
	`;
	assert.ok(source.includes('\\0') && source.includes('\\u0000'));
	assert.deepEqual(nul_lines(bytes(source)), []);
});

test("only a package's own src is read: a fixture app's image under a package's e2e/app/src is not", () => {
	const dir = mkdtempSync(join(tmpdir(), 'nul-bytes-'));
	try {
		const files: Record<string, string> = {
			'packages/a/src/x.ts': 'const k = `\0`;\n',
			'packages/a/e2e/app/src/lib/one.png': '\0PNG\0\n'
		};
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, file)), { recursive: true });
			writeFileSync(join(dir, file), text);
		}
		execFileSync('git', ['init', '-q'], { cwd: dir });
		execFileSync('git', ['add', '-A'], { cwd: dir });
		assert.deepEqual(find_nul_bytes(dir), ['packages/a/src/x.ts:1']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
