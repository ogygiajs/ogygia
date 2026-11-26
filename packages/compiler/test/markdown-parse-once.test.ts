// A markdown page that names a plugin macro is read by micromark once per text in a module's macro
// run: the macro check's scripts and markup and the plugin's own regions read the same parse.
import { expect, it, vi } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import type { Profiler } from '../src/driver.ts';

const parses = vi.hoisted(() => ({ n: 0 }));

vi.mock('micromark', async (original) => {
	const real = (await original()) as typeof import('micromark');
	return {
		...real,
		parse: (...args: Parameters<typeof real.parse>) => {
			parses.n++;
			return real.parse(...args);
		}
	};
});

const { run_module_macros } = await import('../src/macros/pipeline.ts');

const NO_PROFILE = { P: false } as unknown as Profiler;

it("a markdown page is parsed once per text: once for the plugin's regions, once for the check of what it wrote", async () => {
	const call = "import.meta.og.image('./a.jpg')";
	const page = dedent`
		---
		title: Post
		---

		<script>
			const a = ${call};
		</script>

		Write \`${call}\`:

		<Img of={a} />
	`;
	let read = 0;
	const out = await run_module_macros(
		page,
		'/app/src/routes/+page.svx',
		{
			root: '/app',
			alias: [],
			pkgRoot: '/og',
			dollarHoists: new Map(),
			ownSource: () => true,
			markdownExts: ['.svx'],
			macros: [
				{
					name: 'image',
					handler: (code, ctx) => {
						read += ctx.regions(code)?.length ?? 0;
						return code.replace(`const a = ${call}`, "const a = 'a.jpg'");
					}
				}
			]
		},
		NO_PROFILE
	);
	expect(out.touched).toBe(true);
	expect(read).toBe(1);
	expect(parses.n).toBe(2);
});
