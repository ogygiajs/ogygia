// The NUL byte check (./nul-bytes.ts): a raw NUL is named by its line, an escaped one is not.
// Run by plain node: `node --test internal/checks/nul-bytes.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedent } from '@ogygia/core/plugin/utils';
import { nul_lines } from './nul-bytes.ts';

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
