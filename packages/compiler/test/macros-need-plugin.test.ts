// A first-party plugin's `import.meta.og.*` macro used without its plugin listed fails the build with
// `macro_needs_plugin`, naming the package and the plugin to list. Before, the call reached the
// browser or the server untouched and threw a bare TypeError there.
import { describe, expect, it } from 'vitest';
import { run_module_macros, type MacroPipelineCtx } from '../src/macros/pipeline.ts';
import type { Profiler } from '../src/driver.ts';

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

	it("a component's markup that shows a macro call as text is no call (a docs page about the macro)", async () => {
		const svelte = `<script>\n\texport const n = 1;\n</script>\n\n<p>Write <code>import.meta.og.image('./hero.jpg')</code> in the script.</p>\n`;
		expect(
			await run_module_macros(svelte, '/app/src/routes/+page.svelte', ctx(), NO_PROFILE)
		).toEqual({ code: svelte, touched: false, maps: [] });
		const svx = `---\ntitle: Images\n---\n\n\`import.meta.og.image(path)\` reads an image file at build.\n`;
		expect(await run_module_macros(svx, '/app/src/content/+doc.svx', ctx(), NO_PROFILE)).toEqual({
			code: svx,
			touched: false,
			maps: []
		});
	});

	it("a call in a component's script still fails the build without its plugin", async () => {
		const svelte = `<script>\n\tconst hero = import.meta.og.image('./hero.jpg');\n</script>\n\n<img src={hero.src} alt="" />\n`;
		await expect(
			run_module_macros(svelte, '/app/src/routes/+page.svelte', ctx(), NO_PROFILE)
		).rejects.toMatchObject({ code: 'macro_needs_plugin' });
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
