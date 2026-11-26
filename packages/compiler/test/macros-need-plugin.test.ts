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

	it("a call in a markdown page's prose expression fails the build without its plugin", async () => {
		const page = dedent`
			# Hi

			<img src={import.meta.og.bake(() => 1)} alt="" />

			And {import.meta.og.code('x')} inline.
		`;
		await expect(
			run_module_macros(
				page,
				'/app/src/routes/+page.svx',
				{ ...ctx(), markdownExts: ['.svx'] },
				NO_PROFILE
			)
		).rejects.toMatchObject({ code: 'macro_needs_plugin' });
	});

	it("a markdown page's prose that writes a call as text, a code span or a comment is no call", async () => {
		const page = dedent`
			# Images

			Write import.meta.og.image('./hero.jpg') in a script, or \`{import.meta.og.image('./a.jpg')}\`.

			<!-- {import.meta.og.bake(() => 1)} -->
		`;
		expect(
			await run_module_macros(
				page,
				'/app/src/routes/+page.svx',
				{ ...ctx(), markdownExts: ['.svx'] },
				NO_PROFILE
			)
		).toEqual({ code: page, touched: false, maps: [] });
	});

	it("with the plugin listed, a call in a component's template fails the build with macro_in_markup", async () => {
		const svelte = dedent`
			<script>
				export const n = 1;
			</script>

			<img src={import.meta.og.image('./x.jpg')} alt="" />
		`;
		await expect(
			run_module_macros(
				svelte,
				'/app/src/routes/+page.svelte',
				ctx([{ name: 'image', handler: (code) => code }]),
				NO_PROFILE
			)
		).rejects.toMatchObject({
			code: 'macro_in_markup',
			message: expect.stringMatching(
				/\+page\.svelte:5 — import\.meta\.og\.image\(\) sits in the markup/
			)
		});
	});

	it("with the plugin listed, a call in a markdown page's prose expression fails with macro_in_markup", async () => {
		const page = `# Hi\n\n<img src={import.meta.og.bake(() => 1)} alt="" />\n`;
		await expect(
			run_module_macros(
				page,
				'/app/src/routes/+page.svx',
				{ ...ctx([{ name: 'bake', handler: (code) => code }]), markdownExts: ['.svx'] },
				NO_PROFILE
			)
		).rejects.toMatchObject({
			code: 'macro_in_markup',
			message: expect.stringMatching(
				/\+page\.svx:3 — import\.meta\.og\.bake\(\) sits in the markup/
			)
		});
	});

	it("with the plugin listed, a call its handler left in a markdown page's script fails with macro_in_markup", async () => {
		const page = `<script>\n\tconst v = import.meta.og.bake(() => 1);\n</script>\n\n# Hi\n`;
		await expect(
			run_module_macros(
				page,
				'/app/src/routes/+page.svx',
				{ ...ctx([{ name: 'bake', handler: (code) => code }]), markdownExts: ['.svx'] },
				NO_PROFILE
			)
		).rejects.toMatchObject({
			code: 'macro_in_markup',
			message: expect.stringMatching(
				/\+page\.svx:2 — import\.meta\.og\.bake\(\) sits in a markdown page's <script>/
			)
		});
	});

	it("a handler is handed the module's code regions: a markdown page's scripts, not its fenced code", async () => {
		const page = dedent`
			<script>
				const v = import.meta.og.image('./a.jpg');
			</script>

			\`\`\`svelte
			<script>
				const w = import.meta.og.image('./b.jpg');
			</script>
			\`\`\`
		`;
		const seen: string[] = [];
		const out = await run_module_macros(
			page,
			'/app/src/routes/+page.svx',
			{
				...ctx([
					{
						name: 'image',
						handler: (code, m) => {
							const regions = m.regions(code) ?? [];
							for (const r of regions) seen.push(r.code.trim());
							const r = regions[0]!;
							const at = r.offset + r.code.indexOf('import.meta.og.image');
							return [{ start: at, end: at + "import.meta.og.image('./a.jpg')".length, text: '1' }];
						}
					}
				]),
				markdownExts: ['.svx']
			},
			NO_PROFILE
		);
		expect(seen).toEqual(["const v = import.meta.og.image('./a.jpg');"]);
		expect(out.code).toContain('const v = 1;');
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
