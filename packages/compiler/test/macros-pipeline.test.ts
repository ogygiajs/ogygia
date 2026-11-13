// The module-macro pipeline (src/compiler/macros/pipeline.ts): each pass rewrites only when its
// marker is present, feeds the next pass, and says it touched the module; the app's own source only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	run_module_macros,
	type MacroPipelineCtx,
	type PluginMacro
} from '../src/compiler/macros/pipeline.ts';
import type { Profiler } from '../src/compiler/driver.ts';
import { __set_build_cache_root } from '../src/compiler/build-cache.ts';

__set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-macro-pipe-cache-')));

const ROOT = '/app';
const APP = `${ROOT}/src/lib/cms.ts`;
const DEP = `${ROOT}/node_modules/some-lib/index.js`;
const OWN = '/og/src/x.ts';
const NO_PROFILE = { P: false } as unknown as Profiler;

const ctx = (over: Partial<MacroPipelineCtx> = {}): MacroPipelineCtx => ({
	root: ROOT,
	alias: [],
	pkgRoot: '/og/',
	dollarHoists: new Map(),
	ownSource: (id) => !id.includes('/node_modules/'),
	...over
});

const run = async (...args: Parameters<typeof run_module_macros>) => {
	const { code, touched } = await run_module_macros(...args);
	return { code, touched };
};

const SOURCE = `export const loadDoc = import.meta.og.source(async (slug) => slug);\n`;
const STORE = `export const createCart = import.meta.og.store((seed = []) => ({ subscribe: () => {}, seed }));\n`;
const AUTO = `export const createTabs = (i) => ({ subscribe: () => {}, active: i });\n`;

describe('the core passes', () => {
	it('og.source is rewritten in the app, stamped by its root-relative file', async () => {
		const out = await run_module_macros(SOURCE, `${APP}?v=1`, ctx(), NO_PROFILE);
		expect(out.touched).toBe(true);
		expect(out.code).toContain('__og_source("src/lib/cms.ts#loadDoc"');
	});

	it('og.store is rewritten in the app', async () => {
		const out = await run_module_macros(STORE, APP, ctx(), NO_PROFILE);
		expect(out.touched).toBe(true);
		expect(out.code).toContain('__og_store("src/lib/cms.ts#store0"');
	});

	it.each([
		['source', SOURCE],
		['store', STORE]
	])('og.%s in an installed file fails the build', async (macro, src) => {
		await expect(run_module_macros(src, DEP, ctx(), NO_PROFILE)).rejects.toMatchObject({
			code: 'macro_outside_app'
		});
		await expect(run_module_macros(src, DEP, ctx(), NO_PROFILE)).rejects.toThrow(macro);
	});

	it("a store factory is branded in the app's source only", async () => {
		const out = await run_module_macros(AUTO, APP, ctx(), NO_PROFILE);
		expect(out.touched).toBe(true);
		expect(out.code).toContain('__og_store("src/lib/cms.ts#auto:createTabs"');
		// (an installed package, and ogygia's own source, are never branded: even when declared)
		const own = () => true;
		expect(await run(AUTO, DEP, ctx({ ownSource: own }), NO_PROFILE)).toEqual({
			code: AUTO,
			touched: false
		});
		expect(await run(AUTO, OWN, ctx({ ownSource: own }), NO_PROFILE)).toEqual({
			code: AUTO,
			touched: false
		});
	});

	it('a module with no marker is untouched', async () => {
		const src = `export const n = 1;\n`;
		expect(await run(src, APP, ctx(), NO_PROFILE)).toEqual({
			code: src,
			touched: false
		});
	});

	it('one module through every pass: each feeds the next', async () => {
		const out = await run_module_macros(SOURCE + STORE, APP, ctx(), NO_PROFILE);
		expect(out.code).toContain('__og_source(');
		expect(out.code).toContain('__og_store(');
		expect(out.code).not.toContain('import.meta.og.');
	});
});

describe("the plugins' macros", () => {
	const seen: Array<[string, string, string]> = [];
	const macro = (name: string, to: (code: string) => string): PluginMacro => ({
		name,
		handler: (code, m) => {
			seen.push([name, m.id, m.rel]);
			return to(code);
		}
	});

	it('each runs only when its marker is present, in plugin order, on what the last one made', async () => {
		seen.length = 0;
		const macros = [
			macro('first', (c) => c.replace('import.meta.og.first()', 'import.meta.og.second()')),
			macro('second', (c) => c.replace('import.meta.og.second()', '"done"')),
			macro('absent', (c) => `${c}// absent ran\n`)
		];
		const out = await run(
			'export const v = import.meta.og.first();\n',
			`${APP}?x`,
			ctx({ macros }),
			NO_PROFILE
		);
		expect(out).toEqual({ code: 'export const v = "done";\n', touched: true });
		expect(seen).toEqual([
			['first', APP, 'src/lib/cms.ts'],
			['second', APP, 'src/lib/cms.ts']
		]);
	});

	it('a macro that rewrites nothing leaves the module untouched', async () => {
		const src = 'export const v = import.meta.og.noop();\n';
		const out = await run(src, APP, ctx({ macros: [macro('noop', (c) => c)] }), NO_PROFILE);
		expect(out).toEqual({ code: src, touched: false });
	});

	it('one that would rewrite an installed file fails the build, by its name', async () => {
		const macros = [macro('x', (c) => c.replace('import.meta.og.x()', '1'))];
		await expect(
			run_module_macros('export const v = import.meta.og.x();\n', DEP, ctx({ macros }), NO_PROFILE)
		).rejects.toMatchObject({ code: 'macro_outside_app' });
	});
});

describe('a macro its plugin brings', () => {
	it('a profiled build counts each run of one', async () => {
		const prof = { macroMs: 0, macroN: 0 };
		const slow: PluginMacro = {
			name: 'bake',
			handler: async (code) => {
				await new Promise((r) => setTimeout(r, 2));
				return code.replace('import.meta.og.bake(() => 6 * 7)', '42');
			}
		};
		const out = await run(
			'export const v = import.meta.og.bake(() => 6 * 7);\n',
			APP,
			ctx({ macros: [slow] }),
			{ P: true, prof } as unknown as Profiler
		);
		expect(out).toEqual({ code: 'export const v = 42;\n', touched: true });
		expect(prof.macroN).toBe(1);
		expect(prof.macroMs).toBeGreaterThan(0);
	});

	it('one whose plugin is not listed fails the build, naming the package to list', async () => {
		await expect(
			run('export const v = import.meta.og.bake(() => 1);\n', APP, ctx(), NO_PROFILE)
		).rejects.toMatchObject({ code: 'macro_needs_plugin' });
		await expect(
			run('export const v = import.meta.og.bake(() => 1);\n', APP, ctx(), NO_PROFILE)
		).rejects.toThrow('@ogygia/bake');
	});
});
