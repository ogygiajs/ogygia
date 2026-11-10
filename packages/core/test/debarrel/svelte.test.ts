/**
 * Svelte importers: script blocks found by the Svelte parser (never a regex over markup), both
 * `<script>` and `<script module>`, `lang="ts"`, and the traps — a `<script>` inside `{@html}` or a
 * template string, a component with no script, a syntax error, a region-marked import.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, type Fixture } from './_fixture.ts';
import { dedent } from '../../src/compiler/dedent.ts';

let f: Fixture;
afterEach(() => f?.dispose());

const lib = () => ({
	'lib/Button.svelte': '<button>x</button>',
	'lib/util.ts': 'export const util = 1; export type T = 1;',
	'lib/index.ts': `export { default as Button } from './Button.svelte';\nexport { util, type T } from './util';`
});

describe('rewrite_svelte', () => {
	it('rewrites the instance script and leaves the markup byte-identical', async () => {
		f = fixture({
			...lib(),
			'src/App.svelte': `${dedent`
				<script lang="ts">
					import { Button, util } from '$lib';
					let n: number = util;
				</script>

				<Button>{n}</Button>
				<p>{@html '<script>alert(1)</script>'}</p>
			`}\n`
		});
		expect(await f.rewrite('src/App.svelte')).toBe(
			`${dedent`
				<script lang="ts">
					import Button from '${f.id('lib/Button.svelte')}';
				import { util } from '${f.id('lib/util.ts')}';
					let n: number = util;
				</script>

				<Button>{n}</Button>
				<p>{@html '<script>alert(1)</script>'}</p>
			`}\n`
		);
	});

	it('rewrites the module script too, and both when present; attributes ride along', async () => {
		f = fixture({
			...lib(),
			'src/App.svelte': dedent`
				<script module>
					import { util } from '$lib';
					export const meta = util;
				</script>
				<script>
					import { Button } from '$lib' with { type: 'x' };
				</script>
				<Button />
			`
		});
		expect(await f.rewrite('src/App.svelte')).toBe(
			dedent`
				<script module>
					import { util } from '${f.id('lib/util.ts')}';
					export const meta = util;
				</script>
				<script>
					import Button from '${f.id('lib/Button.svelte')}' with { type: 'x' };
				</script>
				<Button />
			`
		);
	});

	it('a region-marked import in a component is left alone under the skip policy; the unmarked one next to it moves', async () => {
		f = fixture({
			...lib(),
			'src/App.svelte': dedent`
				<script>
					import { Button } from '$lib' with { wake: 'visible' };
					import { util } from '$lib';
				</script>
				<Button>{util}</Button>
			`
		});
		const skip = (decl: { attribute_keys: string[] }) => decl.attribute_keys.includes('wake');
		expect(await f.rewrite('src/App.svelte', undefined, { skip })).toBe(
			dedent`
				<script>
					import { Button } from '$lib' with { wake: 'visible' };
					import { util } from '${f.id('lib/util.ts')}';
				</script>
				<Button>{util}</Button>
			`
		);
	});

	it('`lang="ts"` types in the script do not break the parse (satisfies, generics, `as const`)', async () => {
		f = fixture({
			...lib(),
			'src/App.svelte': dedent`
				<script lang="ts">
					import { util, type T } from '$lib';
					const x = { a: 1 } satisfies Record<string, T>;
					let y = $state<T[]>([] as const as T[]);
				</script>
			`
		});
		expect(await f.rewrite('src/App.svelte')).toBe(
			dedent`
				<script lang="ts">
					import { util, type T } from '${f.id('lib/util.ts')}';
					const x = { a: 1 } satisfies Record<string, T>;
					let y = $state<T[]>([] as const as T[]);
				</script>
			`
		);
	});

	it('import-looking text in a template string, a comment, and the markup is never rewritten', async () => {
		f = fixture({
			...lib(),
			'src/App.svelte': dedent`
				<script>
					import { util } from '$lib';
					// import { Button } from '$lib';
					const s = \`<script>import { Button } from '$lib';\`;
				</script>
				<pre>{s}</pre>
				<p>{@html "<script>import { Button } from '$lib';</script>"}</p>
			`
		});
		const out = (await f.rewrite('src/App.svelte'))!;
		expect(out).toContain(`import { util } from '${f.id('lib/util.ts')}';`);
		expect(out).toContain(`// import { Button } from '$lib';`);
		expect(out).toContain(`const s = \`<script>import { Button } from '$lib';\`;`);
		expect(out).toContain(`{@html "<script>import { Button } from '$lib';</script>"}`);
		expect(out).not.toContain('Button.svelte');
	});

	it('a <style lang="scss"> the CSS parser rejects no longer skips the file; the style stays byte-identical', async () => {
		// `#{$i}` and `@for` threw css_expected_identifier in Svelte's parser, and the whole file was
		// skipped: its barrel imports stayed, and its island shipped the whole barrel
		const style = dedent`
			<style lang="scss">
			@for $i from 1 through 3 {
				:global(.ql-indent-#{$i}) { padding-left: #{$i * 3}em; }
			}
			@each $k in a, b { .x-#{$k} { color: red } }
			</style>
		`;
		f = fixture({
			...lib(),
			'src/App.svelte': `${dedent`
				<script>
					import { Button, util } from '$lib';
				</script>

				<Button>{util}</Button>
				${style}
			`}\n`
		});
		const out = await f.rewrite('src/App.svelte');
		expect(out).toBe(
			`${dedent`
				<script>
					import Button from '${f.id('lib/Button.svelte')}';
				import { util } from '${f.id('lib/util.ts')}';
				</script>

				<Button>{util}</Button>
				${style}
			`}\n`
		);
	});

	it('a script AFTER the style block is rewritten at the right place (the blanking keeps every offset)', async () => {
		const style = dedent`
			<style lang="scss">
			.a { .b-#{$x} { color: red } }
			</style>
		`;
		f = fixture({
			...lib(),
			'src/App.svelte': dedent`
				${style}
				<script lang="ts">
					import { util } from '$lib';
					const label = '<style>not css</style>';
				</script>
				<p>{util}{label}</p>
			`
		});
		expect(await f.rewrite('src/App.svelte')).toBe(
			dedent`
				${style}
				<script lang="ts">
					import { util } from '${f.id('lib/util.ts')}';
					const label = '<style>not css</style>';
				</script>
				<p>{util}{label}</p>
			`
		);
	});

	it('blank_styles: only style content, newlines kept, a <style> string inside a script untouched', async () => {
		const { blank_styles } = await import('../../src/compiler/debarrel/svelte.ts');
		const src = dedent`
			<script>const s = '<style>x{}</style>';</script>
			<STYLE lang="scss">
			.a-#{$i} {}
			</STYLE>
			<styles-not>keep</styles-not>
		`;
		const out = blank_styles(src);
		expect(out.length).toBe(src.length);
		expect(out).toContain(`const s = '<style>x{}</style>';`);
		expect(out).toContain(dedent`
			<STYLE lang="scss">
			${' '.repeat('.a-#{$i} {}'.length)}
			</STYLE>
		`);
		expect(out).toContain('<styles-not>keep</styles-not>');
	});

	it('a component that still cannot be parsed is reported (code and position), never skipped in silence', async () => {
		const { rewrite_svelte } = await import('../../src/compiler/debarrel/svelte.ts');
		const why: { code: string; line?: number }[] = [];
		const r = await rewrite_svelte(
			dedent`
				<script>import { A } from './barrel';</script>
				<div>
				<p>{unclosed</p>
			`,
			'/x/Broken.svelte',
			async () => null,
			{},
			(w) => why.push(w)
		);
		expect(r).toBeNull();
		expect(why).toHaveLength(1);
		expect(why[0].code).toBeTruthy();
		expect(why[0].line).toBeGreaterThan(1);
	});

	it('no script, a component that imports no barrel, and a syntax error all leave the file alone', async () => {
		f = fixture({
			...lib(),
			'src/None.svelte': `<p>hello</p>`,
			'src/Plain.svelte': `<script>import { x } from './x.js';</script>`,
			'src/Broken.svelte': `<script>import { from '$lib';</script>`,
			'src/Unclosed.svelte': `<script>import { util } from '$lib';\n<div>`,
			'src/x.js': 'export const x = 1;'
		});
		expect(await f.rewrite('src/None.svelte')).toBeNull();
		expect(await f.rewrite('src/Plain.svelte')).toBeNull();
		expect(await f.rewrite('src/Broken.svelte')).toBeNull();
		expect(await f.rewrite('src/Unclosed.svelte')).toBeNull();
	});

	it('a `.svelte.ts` module goes through the plain rewriter', async () => {
		f = fixture({
			...lib(),
			'src/state.svelte.ts': `import { util } from '$lib';\nexport const n = $state(util);`
		});
		expect(await f.rewrite('src/state.svelte.ts')).toBe(
			`import { util } from '${f.id('lib/util.ts')}';\nexport const n = $state(util);`
		);
	});

	it('a barrel that re-exports a Svelte component through a nested barrel still lands on the .svelte file', async () => {
		f = fixture({
			'lib/atoms/Button.svelte': '<button/>',
			'lib/atoms/index.ts': `export { default as Button } from './Button.svelte';`,
			'lib/index.ts': `export * from './atoms';`,
			'src/App.svelte': `<script>import { Button } from '$lib';</script><Button/>`
		});
		expect(await f.rewrite('src/App.svelte')).toBe(
			`<script>import Button from '${f.id('lib/atoms/Button.svelte')}';</script><Button/>`
		);
	});
});
