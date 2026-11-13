// The island-deps handoff reaches SSR three ways: the JSON under Kit's outDir, a copy beside the
// server bundle, and inlined into every server chunk that carries the token slot (what survives
// serverless tracing). The inline must read back as the same JSON in either quote style, whatever
// characters it holds; files without the slot, and files that are not `.js`, stay byte for byte.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emit_island_deps_handoff } from '../src/compiler/link/build-output.ts';
import { code_fn } from './_code-fn.ts';

const TOKEN = '__OGYGIA_ISLAND_DEPS_INLINE__';
const JSON_TEXT = JSON.stringify({
	js: { '/a.js': ['/b.js'] },
	text: `quotes ' " \` back\\slash     </script> \${x} $& $1`
});

let out: string;
beforeEach(() => {
	out = fs.mkdtempSync(path.join(os.tmpdir(), 'og-handoff-'));
});
afterEach(() => {
	fs.rmSync(out, { recursive: true, force: true });
});

const write = (rel: string, text: string) => {
	const file = path.join(out, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
	return file;
};
/** The value a chunk's `export const deps = <literal>;` holds once patched. */
const literal_of = (file: string) =>
	code_fn(`${fs.readFileSync(file, 'utf8').replace('export const deps =', 'return')}`)() as string;

describe('emit_island_deps_handoff', () => {
	it('writes the handoff and the server copy', () => {
		emit_island_deps_handoff('/app', JSON_TEXT, out, new Map());
		expect(fs.readFileSync(path.join(out, 'og-region-deps.json'), 'utf8')).toBe(JSON_TEXT);
		expect(fs.readFileSync(path.join(out, 'output', 'server', 'og-region-deps.json'), 'utf8')).toBe(
			JSON_TEXT
		);
	});

	it('inlines into every slotted server chunk, nested, in either quote style', () => {
		const double = write('output/server/index.js', `export const deps = "${TOKEN}";`);
		const single = write('output/server/chunks/deep/x.js', `export const deps = '${TOKEN}';`);
		const counts = new Map<string, number>();
		emit_island_deps_handoff('/app', JSON_TEXT, out, counts);
		expect(counts.get('island deps'), 'each patch is counted on the leg').toBe(2);
		expect(literal_of(double)).toBe(JSON_TEXT);
		expect(literal_of(single)).toBe(JSON_TEXT);
		expect(JSON.parse(literal_of(single))).toEqual(JSON.parse(JSON_TEXT));
	});

	it('leaves chunks without the slot, and other files, as they were', () => {
		const plain = write('output/server/plain.js', 'export const x = 1;');
		const map = write('output/server/index.js.map', `{"x":"${TOKEN}"}`);
		emit_island_deps_handoff('/app', JSON_TEXT, out, new Map());
		expect(fs.readFileSync(plain, 'utf8')).toBe('export const x = 1;');
		expect(fs.readFileSync(map, 'utf8')).toBe(`{"x":"${TOKEN}"}`);
	});

	it('with no server output yet, still writes the handoff', () => {
		const bare = path.join(out, 'nested', 'kit');
		emit_island_deps_handoff('/app', JSON_TEXT, bare, new Map());
		expect(fs.readFileSync(path.join(bare, 'og-region-deps.json'), 'utf8')).toBe(JSON_TEXT);
	});
});
