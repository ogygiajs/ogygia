// The module macros (`import.meta.og.*`, `bake` above all: it RUNS code at build) rewrite only the
// app's own source and the files a package declares in `ogygia.files`. Any other installed file that
// uses one fails the build with `macro_outside_app`, before anything in it runs; a file that only
// names a marker in a string or comment (ogygia's own message tables) is left alone.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run_module_macros, type MacroPipelineCtx } from '../src/macros/pipeline.ts';
import type { Profiler } from '../src/driver.ts';
import { __set_build_cache_root } from '../src/build-cache.ts';

__set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-macro-own-cache-')));

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'og-macro-own-'));
const DEP = path.join(ROOT, 'node_modules', 'some-lib', 'index.js');
const DECLARED = path.join(ROOT, 'node_modules', 'declared-lib', 'src', 'index.js');
const APP = path.join(ROOT, 'src', 'lib', 'x.ts');
const RAN = path.join(ROOT, 'ran.txt');

const NO_PROFILE = { P: false } as unknown as Profiler;
const ctx = (): MacroPipelineCtx => ({
	root: ROOT,
	alias: [],
	pkgRoot: '/og',
	dollarHoists: new Map(),
	ownSource: (id) => !id.includes('/node_modules/') || id.includes('/declared-lib/')
});

const BAKE = `import fs from 'node:fs';\nexport const v = import.meta.og.bake(() => { fs.writeFileSync(${JSON.stringify(RAN)}, 'x'); return 1; });`;
const WIRE = `export class C { static wire = import.meta.og.wire({ encode: (c) => c.v, decode: (v) => new C(v) }); }`;

describe('module macros: the app’s own source only', () => {
	it('a bake() in an installed file fails the build with a code, and its function never runs', async () => {
		await expect(run_module_macros(BAKE, DEP, ctx(), NO_PROFILE)).rejects.toThrow(
			/macro_outside_app/
		);
		expect(fs.existsSync(RAN)).toBe(false);
	});

	it.each([
		['wire', WIRE],
		['$', `export const f = import.meta.og.$(() => 1);`],
		['source', `export const f = import.meta.og.source(async () => 1);`],
		['store', `export const s = import.meta.og.store((v) => ({ subscribe: () => {}, v }));`]
	])('the %s macro in an installed file fails the same way', async (_name, src) => {
		await expect(run_module_macros(src, DEP, ctx(), NO_PROFILE)).rejects.toThrow(
			/macro_outside_app/
		);
	});

	it('a store-shaped export is auto-branded in app source only, never in an installed file or ogygia', async () => {
		const src = `export const createX = (seed) => ({ subscribe: () => {}, seed });`;
		expect((await run_module_macros(src, APP, ctx(), NO_PROFILE)).code).toContain('__og_store(');
		expect(await run_module_macros(src, DEP, ctx(), NO_PROFILE)).toEqual({
			code: src,
			touched: false,
			maps: []
		});
		const og = path.join(ROOT, 'og', 'store.ts');
		expect(
			await run_module_macros(src, og, { ...ctx(), pkgRoot: path.join(ROOT, 'og') }, NO_PROFILE)
		).toEqual({ code: src, touched: false, maps: [] });
	});

	it('a marker named only in a string or a comment of an installed file is left alone', async () => {
		const src = `// import.meta.og.bake(() => 1)\nexport const t = 'use import.meta.og.wire(…) or import.meta.og.bake(fn)';`;
		const out = await run_module_macros(src, DEP, ctx(), NO_PROFILE);
		expect(out).toEqual({ code: src, touched: false, maps: [] });
	});

	it('a plugin macro in an installed file fails the build, and its handler never runs', async () => {
		const ran: string[] = [];
		const with_macro: MacroPipelineCtx = {
			...ctx(),
			macros: [{ name: 'code', handler: (code, m) => (ran.push(m.id), code.replace('x', 'y')) }]
		};
		await expect(
			run_module_macros(`export const s = import.meta.og.code('x');`, DEP, with_macro, NO_PROFILE)
		).rejects.toThrow(/macro_outside_app/);
		// (a marker in a string only: no call, so nothing to refuse, and still nothing runs)
		const named = `export const t = 'import.meta.og.code(…)';`;
		expect(await run_module_macros(named, DEP, with_macro, NO_PROFILE)).toEqual({
			code: named,
			touched: false,
			maps: []
		});
		expect(ran).toEqual([]);
	});

	it('a file a package declares in ogygia.files, and the app’s own, are rewritten', async () => {
		for (const id of [DECLARED, APP]) {
			const out = await run_module_macros(WIRE, id, ctx(), NO_PROFILE);
			expect(out.touched).toBe(true);
			expect(out.code).not.toContain('import.meta.og.wire');
		}
	});
});
