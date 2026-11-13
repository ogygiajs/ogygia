/**
 * `import { A } from 'barrel' with { wake: 'visible' }` with the pass on: the marked import is
 * pinned (ogygia's prescan keys the island on the raw import, so the transform must see that same
 * import), while a plain import of the same barrel still goes to its leaves. The island's entry
 * imports `{ A }` from the barrel, as the import says. The pipeline here is the real one: the barrel
 * rewrite, then the compiler's `.ts` region transform on its output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, type Fixture } from './_fixture.ts';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { transformTsRegions } from '@ogygia/compiler';
import { ogygia } from '@ogygia/compiler/vite';
import { barrels } from '../src/index.ts';
import { dedent } from '@ogygia/core/plugin/utils';

let f: Fixture;
afterEach(() => f?.dispose());

const ctx = (root: string): Parameters<typeof transformTsRegions>[2] => ({
	root,
	libDir: `${root}/lib`,
	dev: false,
	virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	wrapperPathFor: (_host: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
	devUrlFor: (p: string) => `/@id/${p}`,
	visibleMargin: '0px',
	importKeys: undefined,
	idSalt: ''
});

/** ogygia's pin rule, as `b.pinnedImports` gives it: an import whose `with` carries a region key. */
const skip = (decl: { attribute_keys: readonly string[] }) => decl.attribute_keys.includes('wake');

describe('barrels + a marked named import', () => {
	it('without the pass the marked named import compiles through the barrel', () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/index.ts': `export { default as A } from './A.svelte';`,
			'src/registry.ts': dedent`
				import { A as ARegion } from '$lib' with { wake: 'load' };
				export const registry = [ARegion];
			`
		});
		const r = transformTsRegions(f.read('src/registry.ts'), f.id('src/registry.ts'), ctx(f.root));
		expect(r!.islands).toHaveLength(1);
		expect(String(r!.islands[0].source)).toMatch(/import \{ A as __OgygiaComp_[0-9a-f]+ \} from /);
	});

	it('INSIDE ogygia the marked import is left alone and a plain import of the same barrel is rewritten; the island id is the raw one', async () => {
		// REGRESSION (customer build, 2026-09-15, then on asRegion): the transform saw
		// `import A from '…/A.svelte'` where the prescan (raw source) saw `import { A } from '$lib'` —
		// two island ids, and the server manifest imported a virtual entry nobody registered.
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/B.svelte': '<p>B</p>',
			'lib/util.ts': 'export const util = 1;',
			'lib/index.ts': dedent`
				export { default as A } from './A.svelte';
				export { default as B } from './B.svelte';
				export { util } from './util';
			`,
			'src/registry.ts': dedent`
				import { A as ARegion } from '$lib' with { wake: 'visible' };
				import { B, util } from '$lib';
				export const registry = [ARegion, B, util];
			`
		});
		const rewritten = (await f.rewrite('src/registry.ts', undefined, { skip }))!;
		expect(rewritten).toBe(
			dedent`
				import { A as ARegion } from '$lib' with { wake: 'visible' };
				import B from '${f.id('lib/B.svelte')}';
				import { util } from '${f.id('lib/util.ts')}';
				export const registry = [ARegion, B, util];
			`
		);
		const raw = transformTsRegions(f.read('src/registry.ts'), f.id('src/registry.ts'), ctx(f.root));
		const after = transformTsRegions(rewritten, f.id('src/registry.ts'), ctx(f.root));
		expect(after!.islands[0].id).toBe(raw!.islands[0].id);
	});

	it('barrels() beside ogygia() applies that rule end to end', { timeout: 30_000 }, async () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/util.ts': 'export const util = 1;',
			'lib/index.ts': `export { default as A } from './A.svelte';\nexport { util } from './util';`,
			'src/registry.ts': dedent`
				import { A as R } from '$lib' with { wake: 'load' };
				import { util } from '$lib';
				export const u = [R, util];
			`
		});
		const out = await f.source_stage(
			{
				root: f.root,
				logLevel: 'silent',
				configFile: false,
				resolve: { alias: { $lib: f.id('lib') } },
				optimizeDeps: { noDiscovery: true, include: [] },
				plugins: [ogygia(), barrels(), svelte({ configFile: false })]
			},
			'src/registry.ts'
		);
		expect(out).toBe(
			dedent`
				import { A as R } from '$lib' with { wake: 'load' };
				import { util } from '${f.id('lib/util.ts')}';
				export const u = [R, util];
			`
		);
	});

	it('a region-MARKED barrel import is left to the compiler (skip policy)', async () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/index.ts': `export { default as A } from './A.svelte';`,
			'src/host.ts': `import { A } from '$lib' with { wake: 'visible' };\nexport const x = A;`
		});
		expect(await f.rewrite('src/host.ts', undefined, { skip })).toBeNull();
	});
});
