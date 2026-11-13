// A first-party plugin's `import.meta.og.*` macro used without its plugin listed fails the build with
// `macro_needs_plugin`, naming the package and the plugin to list. Before, the call reached the
// browser or the server untouched and threw a bare TypeError there.
import { describe, expect, it } from 'vitest';
import { run_module_macros, type MacroPipelineCtx } from '../src/compiler/macros/pipeline.ts';
import type { Profiler } from '../src/compiler/driver.ts';

const NO_PROFILE = { P: false } as unknown as Profiler;
const APP = '/app/src/lib/x.ts';
const ctx = (macros: MacroPipelineCtx['macros'] = []): MacroPipelineCtx => ({
	root: '/app',
	alias: [],
	pkgRoot: '/og',
	dollarHoists: new Map(),
	macros,
	ownSource: () => true
});

describe('a plugin macro without its plugin', () => {
	it('fails the build naming the package and the plugin', async () => {
		for (const call of [
			`import.meta.og.code('x')`,
			`import.meta.og.md('# x')`,
			`import.meta.og.loader.git({})`,
			`import.meta.og.regions('x')`
		])
			await expect(
				run_module_macros(`export const v = ${call};`, APP, ctx(), NO_PROFILE)
			).rejects.toThrow(/macro_needs_plugin.*@ogygia\/content|content\(\).*@ogygia\/content/s);
	});

	it('bake() without @ogygia/bake fails the build, and its function never runs', async () => {
		await expect(
			run_module_macros(
				`export const v = import.meta.og.bake(() => { throw new Error('ran'); });`,
				APP,
				ctx(),
				NO_PROFILE
			)
		).rejects.toThrow(/macro_needs_plugin|bake\(\).*@ogygia\/bake/s);
	});

	it('a marker in a string or comment is no call; an unknown macro is not this error', async () => {
		const src = `// import.meta.og.code('x')\nexport const t = 'import.meta.og.md(x)';`;
		expect(await run_module_macros(src, APP, ctx(), NO_PROFILE)).toEqual({
			code: src,
			touched: false,
			maps: []
		});
		const unknown = `export const v = import.meta.og.nothing();`;
		expect((await run_module_macros(unknown, APP, ctx(), NO_PROFILE)).code).toBe(unknown);
	});

	it('with the plugin listed, its handler compiles the call', async () => {
		const out = await run_module_macros(
			`export const v = import.meta.og.code('x');`,
			APP,
			ctx([{ name: 'code', handler: () => `export const v = 'compiled';` }]),
			NO_PROFILE
		);
		expect(out.code).toBe(`export const v = 'compiled';`);
	});
});
