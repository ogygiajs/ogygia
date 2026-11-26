// A first-party plugin's `import.meta.og.*` macro used without its plugin listed fails the build with
// `macro_needs_plugin`, naming the package and the plugin to list. Before, the call reached the
// browser or the server untouched and threw a bare TypeError there.
import { describe, expect, it } from 'vitest';
import { run_module_macros, type MacroPipelineCtx } from '../src/macros/pipeline.ts';
import type { Profiler } from '../src/driver.ts';
import { dedent } from '@ogygia/core/contract';

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
		const svelte = dedent`
			<script>
				export const n = 1;
			</script>

			<p>Write <code>import.meta.og.image('./hero.jpg')</code> in the script.</p>
		`;
		expect(
			await run_module_macros(svelte, '/app/src/routes/+page.svelte', ctx(), NO_PROFILE)
		).toEqual({ code: svelte, touched: false, maps: [] });
		const svx = dedent`
			---
			title: Images
			---

			\`import.meta.og.image(path)\` reads an image file at build.
		`;
		expect(await run_module_macros(svx, '/app/src/content/+doc.svx', ctx(), NO_PROFILE)).toEqual({
			code: svx,
			touched: false,
			maps: []
		});
	});

	it("a call in a component's script still fails the build without its plugin", async () => {
		const svelte = dedent`
			<script>
				const hero = import.meta.og.image('./hero.jpg');
			</script>

			<img src={hero.src} alt="" />
		`;
		await expect(
			run_module_macros(svelte, '/app/src/routes/+page.svelte', ctx(), NO_PROFILE)
		).rejects.toMatchObject({ code: 'macro_needs_plugin' });
	});

	it("a call in a markdown page's script fails the build without its plugin (.svx, .md)", async () => {
		const page = dedent`
			---
			title: Post
			---

			<script>
				const v = import.meta.og.bake(() => 1);
			</script>

			Text.
		`;
		for (const file of ['/app/src/content/post.svx', '/app/src/routes/+page.md'])
			await expect(
				run_module_macros(page, file, { ...ctx(), markdownExts: ['.svx', '.md'] }, NO_PROFILE)
			).rejects.toMatchObject({ code: 'macro_needs_plugin' });
	});

	it("a markdown page's fenced code that shows a <script> with a call is no call", async () => {
		const svx = dedent`
			# Images

			\`\`\`svelte
			<script>
				const hero = import.meta.og.image('./hero.jpg');
			</script>
			\`\`\`

			Write \`<script>\` blocks at the top.
		`;
		expect(
			await run_module_macros(
				svx,
				'/app/src/content/+doc.svx',
				{ ...ctx(), markdownExts: ['.svx', '.md'] },
				NO_PROFILE
			)
		).toEqual({ code: svx, touched: false, maps: [] });
	});

	it("a call in a component's template expression fails the build without its plugin", async () => {
		const svelte = dedent`
			<script>
				export const n = 1;
			</script>

			<img src={import.meta.og.bake(() => '/x.jpg')} alt="" />
		`;
		await expect(
			run_module_macros(svelte, '/app/src/routes/+page.svelte', ctx(), NO_PROFILE)
		).rejects.toMatchObject({ code: 'macro_needs_plugin' });
	});

	it('markup Svelte cannot parse names no template call: the check passes it on, for the Svelte compile to report', async () => {
		const svelte = `<p>{import.meta.og.bake(</p>`;
		expect(
			await run_module_macros(svelte, '/app/src/routes/+page.svelte', ctx(), NO_PROFILE)
		).toEqual({ code: svelte, touched: false, maps: [] });
	});

	it("a dependency's call in its markup is refused as outside the app", async () => {
		const svelte = `<img src={import.meta.og.image('./x.jpg')} alt="" />`;
		await expect(
			run_module_macros(
				svelte,
				'/app/node_modules/x/Pic.svelte',
				{
					...ctx([{ name: 'image', handler: (code) => code }]),
					ownSource: () => false
				},
				NO_PROFILE
			)
		).rejects.toMatchObject({ code: 'macro_outside_app' });
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
