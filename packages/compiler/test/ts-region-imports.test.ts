// A region import in a `.ts` / `.js` module is read from the module's AST, as in a `.svelte` host:
// a comment or a line break never hides one, a form that is not a default import is refused with
// the host's message (it was left as a plain import, in silence), and an import that is only text
// (a string, a template, a comment) is never taken.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import { transformTsRegions } from '../src/compiler/region/transform.ts';

type Ctx = Parameters<typeof transformTsRegions>[2];
const CTX = {
	root: '/app',
	libDir: '/app/src/lib',
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => `/@id/${p}`,
	importKeys: undefined,
	visibleMargin: '0px',
	pathModule: path
} as Ctx;

const compile = (code: string) => transformTsRegions(code, '/app/src/lib/regions.ts', CTX);

describe('a region import in a .ts module', () => {
	it.each([
		`import X from '$lib/X.svelte' /* why */ with { wake: 'load' };`,
		`import X from '$lib/X.svelte'\n\twith { wake: 'load' };`,
		dedent`
			import X from '$lib/X.svelte' with {
				wake: 'load'
			};
		`,
		`import X from '$lib/X.svelte' with { "wake": "load" };`,
		`import X from '$lib/X.svelte' with { wake: 'load' }`
	])('%s becomes a region', (line) => {
		const out = compile(`${line}\nexport const r = X;`);
		expect(out?.islands).toHaveLength(1);
		expect(out!.code).toMatch(
			/^import X from "ogygia:region\/binding\/[0-9a-f]{12}\.js";\nexport const r = X;$/
		);
	});

	it.each([
		`import { X } from '$lib/X.svelte' with { wake: 'load' };`,
		`import X, { y } from '$lib/X.svelte' with { wake: 'load' };`,
		`import * as X from '$lib/X.svelte' with { wake: 'load' };`,
		`import '$lib/X.svelte' with { wake: 'load' };`,
		`export { default as X } from '$lib/X.svelte' with { wake: 'load' };`,
		`export * from '$lib/X.svelte' with { region: 'raw' };`
	])('%s is refused', (line) => {
		expect(() => compile(line)).toThrow(/must be a default import/);
	});

	it.each([
		`const s = "import X from '$lib/X.svelte' with { wake: 'load' }";`,
		"const s = `import X from '$lib/X.svelte' with { wake: 'load' }`;",
		`// import X from '$lib/X.svelte' with { wake: 'load' }`,
		`/** @example import X from '$lib/X.svelte' with { wake: 'load' } */`
	])('%s is only text', (line) => {
		expect(
			compile(dedent`
			${line}
			export const n = 1;
		`)
		).toBe(null);
	});

	it('rewrites at the right place after text outside ASCII', () => {
		const out = compile(dedent`
			// ünïcödé ✓ 🌊
			import X from '$lib/X.svelte' with { wake: 'load' };
			export const r = X;
		`);
		expect(out!.code).toMatch(
			/^\/\/ ünïcödé ✓ 🌊\nimport X from "ogygia:region\/binding\/[0-9a-f]{12}\.js";\nexport const r = X;$/
		);
	});

	it('an import with other attributes is not a region', () => {
		expect(compile(`import data from './d.json' with { type: 'json' };\nexport { data };`)).toBe(
			null
		);
	});
});
