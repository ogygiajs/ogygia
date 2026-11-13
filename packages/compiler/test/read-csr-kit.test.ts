// A route option file's `csr`, read the way Kit reads it. Kit decides with a parser
// (`statically_analyse_page_options`) and, at run time, the module's value. A pattern read disagreed
// with both on code an app can write (`export let`, several declarators, `export { }`, a string
// that holds the text). Pinned by cases, then by a differential against Kit's own reader over
// generated option files (seeded 314; OGYGIA_FUZZ_SEED, OGYGIA_FUZZ_RUNS).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fc } from '@ogygia/config/sim';
import { node_fs } from '../src/compiler/fs.ts';
import { read_csr, route_reader } from '../src/compiler/kit.ts';

const dir = mkdtempSync(join(tmpdir(), 'og-read-csr-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function read(src: string): boolean | undefined {
	const file = join(dir, `o${n++}.ts`);
	writeFileSync(file, src);
	// (a fresh reader each time: its caches start empty)
	return read_csr(route_reader(node_fs), file);
}

describe('read_csr reads csr like Kit', () => {
	it.each([
		['export const csr = false;', false],
		['export const csr = true;', true],
		['export let csr = false;', false],
		['export var csr = false;', false],
		['export const ssr = true, csr = false;', false],
		['const csr = false; export { csr };', false],
		['const x = false; export { x as csr };', false],
		["const x = false; export { x as 'csr' };", false],
		['export const csr = (false);', false],
		['export const csr: boolean = false;', false],
		['export const csr = false as boolean;', false],
		['export const csr = false satisfies boolean;', false],
		['const s = "export const csr = true"; export const csr = false;', false],
		['const s = `export const csr = true`; export const csr = false;', false],
		['const u = "/*"; export const csr = false; const v = "*/";', false],
		['// export const csr = true\nexport const csr = false;', false],
		['/* export const csr = true */ export const csr = false;', false],
		['export const csrf = true; export const csr = false;', false],
		['export const prerender = true;', undefined],
		['const csr = false;', undefined],
		['export const csr = !0;', undefined],
		["export const csr = 'false';", undefined],
		['export { csr } from "./options";', undefined],
		['export const csr = ', undefined]
	])('%s → %s', (src, want) => {
		expect(read(src)).toBe(want);
	});
});

// Kit's own reader, from the installed Kit (a dev dependency); the differential skips without it.
const kit_reader = await import(
	/* @vite-ignore */ new URL(
		'./vite/static_analysis/index.js',
		import.meta.resolve('@sveltejs/kit')
	).href
).catch(() => null);

describe.skipIf(!kit_reader)('read_csr against Kit’s reader, over generated option files', () => {
	const PIECES = [
		'export const csr = false;',
		'export const csr = true;',
		'export let csr = false;',
		'export var csr = true;',
		'export const ssr = true, csr = false;',
		'const c = false; export { c as csr };',
		'const csr = true; export { csr };',
		'export const prerender = true;',
		'export const ssr = false;',
		'const s = "export const csr = true";',
		"const t = 'export const csr = false';",
		'const u = `export let csr = true`;',
		'// export const csr = true',
		'/* export const csr = false */',
		'const a = "/*";',
		'const b = "*/";',
		'export const csrf = true;',
		'export function load() { return {}; }',
		'import { x } from "./x";'
	];
	const EXPORTS_CSR = /^(export (const|let|var) (ssr = true, )?csr\b|.*export \{ (c as )?csr \})/;
	it('agrees wherever Kit can read a value', () => {
		fc.assert(
			fc.property(fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 5 }), (picks) => {
				// a module exports one `csr` at most (two is a SyntaxError, and Kit keeps the last)
				fc.pre(picks.filter((p) => EXPORTS_CSR.test(p)).length <= 1);
				const src = picks.join('\n');
				let kit: Record<string, unknown> | null;
				try {
					kit = kit_reader!.statically_analyse_page_options('o.ts', src);
				} catch {
					return; // Kit refuses the file (a duplicate declaration): not a case to compare
				}
				if (kit === null) return; // Kit cannot read it statically either
				const want = typeof kit.csr === 'boolean' ? kit.csr : undefined;
				expect(read(src), src).toBe(want);
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 314),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 300)
			}
		);
	});
});
