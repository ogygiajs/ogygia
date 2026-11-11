/**
 * `import { A, B } from 'barrel'; const ARegion = import.meta.og.asRegion(A)` keeps working with the
 * pass on: barrels() runs first and turns the named barrel import into a default import of the leaf
 * file, which is exactly the form `asRegion` already accepts. The island then points at the leaf
 * (one chunk for A), not at the barrel. The pipeline here is the real one — the barrel rewrite,
 * then the compiler's `.ts` region transform on its output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, type Fixture } from './_fixture.ts';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { transformTsRegions, asRegionLocals } from '@ogygia/compiler';
import { ogygia } from '@ogygia/compiler/vite';
import { barrels } from '../src/index.ts';

let f: Fixture;
afterEach(() => f?.dispose());

const ctx = (root: string): Parameters<typeof transformTsRegions>[2] => ({
	root,
	libDir: root + '/lib',
	dev: false,
	virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	wrapperPathFor: (_host: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
	devUrlFor: (p: string) => '/@id/' + p,
	visibleMargin: '0px',
	importKeys: undefined,
	idSalt: ''
});

describe('barrels + import.meta.og.asRegion', () => {
	it('the CORE alone (no ogygia policy) would rewrite an asRegion import to the leaf — which is exactly why ogygia tells it not to (next test)', async () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/B.svelte': '<p>B</p>',
			'lib/index.ts': `export { default as A } from './A.svelte';\nexport { default as B } from './B.svelte';`,
			'src/registry.ts': `import { A, B } from '$lib';\nconst ARegion = import.meta.og.asRegion(A, { wake: 'visible' });\nexport const registry = [ARegion, B];`
		});
		const rewritten = (await f.rewrite('src/registry.ts'))!;
		expect(rewritten).toBe(
			`import A from '${f.id('lib/A.svelte')}';\nimport B from '${f.id('lib/B.svelte')}';\nconst ARegion = import.meta.og.asRegion(A, { wake: 'visible' });\nexport const registry = [ARegion, B];`
		);
		const r = transformTsRegions(rewritten, f.id('src/registry.ts'), ctx(f.root));
		expect(r).not.toBeNull();
		expect(r!.islands).toHaveLength(1);
		const isl = r!.islands[0];
		expect(isl.held).toBe(true);
		expect(String(isl.bindingSsrSource)).toContain('__hydrate: "visible"');
		// the island's entry imports the LEAF file, not the barrel
		expect(String(isl.source)).toMatch(
			/import __OgygiaComp_[0-9a-f]+ from ["'][^"']*\/lib\/A\.svelte["']/
		);
		expect(String(isl.source)).not.toContain('index.ts');
		expect(r!.code).not.toContain('import.meta.og.asRegion');
		// B stays a plain default import of its leaf
		expect(r!.code).toContain(`import B from '${f.id('lib/B.svelte')}';`);
	});

	it('the same file WITHOUT the pass still compiles through the barrel (nothing changed for apps that leave barrels on)', async () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/index.ts': `export { default as A } from './A.svelte';`,
			'src/registry.ts': `import { A } from '$lib';\nconst ARegion = import.meta.og.asRegion(A, { wake: 'load' });\nexport const registry = [ARegion];`
		});
		const r = transformTsRegions(f.read('src/registry.ts'), f.id('src/registry.ts'), ctx(f.root));
		expect(r!.islands).toHaveLength(1);
		expect(String(r!.islands[0].source)).toMatch(/import \{ A as __OgygiaComp_[0-9a-f]+ \} from /);
	});

	it('INSIDE ogygia the import feeding asRegion is left alone: the prescan keys the island on the raw import, the transform must see the same one', async () => {
		// REGRESSION (customer build, 2026-09-15): with the pass on the transform saw
		// `import A from '…/A.svelte'` where the prescan (raw source) saw `import { A } from '$lib'` —
		// two island ids, and the server manifest imported a virtual entry nobody registered:
		// "Rolldown failed to resolve import ogygia:region/entry/<id>.js from ogygia:server/server-manifest".
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/B.svelte': '<p>B</p>',
			'lib/util.ts': 'export const util = 1;',
			'lib/index.ts': `export { default as A } from './A.svelte';\nexport { default as B } from './B.svelte';\nexport { util } from './util';`,
			'src/registry.ts': `import { A, B } from '$lib';\nimport { util } from '$lib';\nconst ARegion = import.meta.og.asRegion(A, { wake: 'visible' });\nexport const registry = [ARegion, B, util];`
		});
		const skip = (decl: { specs: { local: string }[] }) =>
			decl.specs.some((s) => asRegionLocals(f.read('src/registry.ts')).has(s.local));
		expect(await f.rewrite('src/registry.ts', undefined, { skip })).toBe(
			`import { A, B } from '$lib';\nimport { util } from '${f.id('lib/util.ts')}';\nconst ARegion = import.meta.og.asRegion(A, { wake: 'visible' });\nexport const registry = [ARegion, B, util];`
		);
		// and the island id is the one the prescan computes from the raw file
		const raw = transformTsRegions(f.read('src/registry.ts'), f.id('src/registry.ts'), ctx(f.root));
		const rewritten = (await f.rewrite('src/registry.ts', undefined, { skip }))!;
		const after = transformTsRegions(rewritten, f.id('src/registry.ts'), ctx(f.root));
		expect(after!.islands[0].id).toBe(raw!.islands[0].id);
	});

	it('barrels() beside ogygia() applies that rule end to end', { timeout: 30_000 }, async () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/util.ts': 'export const util = 1;',
			'lib/index.ts': `export { default as A } from './A.svelte';\nexport { util } from './util';`,
			'src/registry.ts': `import { A } from '$lib';\nimport { util } from '$lib';\nconst R = import.meta.og.asRegion(A, { wake: 'load' });\nexport const u = [R, util];`
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
			`import { A } from '$lib';\nimport { util } from '${f.id('lib/util.ts')}';\nconst R = import.meta.og.asRegion(A, { wake: 'load' });\nexport const u = [R, util];`
		);
	});

	it('a region-MARKED barrel import is left to the compiler (skip policy), so the mark still errors or works exactly as before', async () => {
		f = fixture({
			'lib/A.svelte': '<h1>A</h1>',
			'lib/index.ts': `export { default as A } from './A.svelte';`,
			'src/host.ts': `import { A } from '$lib' with { wake: 'visible' };\nexport const x = A;`
		});
		const skip = (decl: { attribute_keys: string[] }) => decl.attribute_keys.includes('wake');
		expect(await f.rewrite('src/host.ts', undefined, { skip })).toBeNull();
	});
});
