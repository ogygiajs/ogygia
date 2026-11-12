/**
 * The importer rewrite: exact output for every import shape, what stays on the barrel and why,
 * attributes and type modifiers preserved, sourcemaps, the mark-skip policy, and the cursed spellings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/plugin/utils';
import { fixture, type Fixture } from './_fixture.ts';
import MagicString from 'magic-string';
import { rewrite_imports } from '../src/rewrite.ts';

let f: Fixture;
afterEach(() => f?.dispose());

const q = (f: Fixture, rel: string) => `'${f.id(rel)}'`;

const base = () => ({
	'lib/a.ts': 'export const a = 1; export const b = 2;',
	'lib/Button.svelte': '<button>x</button>',
	'lib/Card.svelte': '<div/>',
	'lib/types.ts': 'export type T = number; export interface I {}',
	'lib/ns.ts': 'export const one = 1;',
	'lib/index.ts': dedent`
		export { a, b as bee } from './a';
		export { default as Button } from './Button.svelte';
		export { default as Card } from './Card.svelte';
		export type { T, I } from './types';
		export * as ns from './ns';
	`
});

describe('rewrite — output shapes', () => {
	it('named imports go to their leaves, one import per leaf, local names unchanged; the barrel import disappears', async () => {
		f = fixture({
			...base(),
			'src/app.ts': `import { a, bee as B, Button, Card } from '$lib';\nconsole.log(a, B, Button, Card);`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			dedent`
				import { a, b as B } from ${q(f, 'lib/a.ts')};
				import Button from ${q(f, 'lib/Button.svelte')};
				import Card from ${q(f, 'lib/Card.svelte')};
				console.log(a, B, Button, Card);
			`
		);
	});

	it('import attributes ride onto every leaf import', async () => {
		f = fixture({
			...base(),
			'src/app.ts': `import { Button, Card } from '$lib' with { type: 'component' };`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			`import Button from ${q(f, 'lib/Button.svelte')} with { type: 'component' };\nimport Card from ${q(f, 'lib/Card.svelte')} with { type: 'component' };`
		);
	});

	it('the skip policy leaves an import with a listed attribute key untouched — the ogygia mark stays on the barrel', async () => {
		f = fixture({
			...base(),
			'src/app.ts': dedent`
				import { Button } from '$lib' with { wake: 'visible' };
				import { Card } from '$lib';
				import { a } from '$lib' with { render: 'deferred', fetch: 'load' };
			`
		});
		const skip = (decl: { attribute_keys: string[] }) =>
			decl.attribute_keys.some((k) => k === 'wake' || k === 'render');
		expect(await f.rewrite('src/app.ts', undefined, { skip })).toBe(
			dedent`
				import { Button } from '$lib' with { wake: 'visible' };
				import Card from ${q(f, 'lib/Card.svelte')};
				import { a } from '$lib' with { render: 'deferred', fetch: 'load' };
			`
		);
	});

	it('type-only: an `import type {}` declaration is left alone (erased, no edge); a mixed import splits, and a leaf that only gets `type` specifiers is imported `type`', async () => {
		f = fixture({
			...base(),
			'src/app.ts': dedent`
				import type { T } from '$lib';
				import { type I, a } from '$lib';
				import type { T as TT, I as II } from '$lib';
				import { type T as T3, a as a3, bee as b3 } from '$lib';
			`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			dedent`
				import type { T } from '$lib';
				import type { I } from ${q(f, 'lib/types.ts')};
				import { a } from ${q(f, 'lib/a.ts')};
				import type { T as TT, I as II } from '$lib';
				import type { T as T3 } from ${q(f, 'lib/types.ts')};
				import { a as a3, b as b3 } from ${q(f, 'lib/a.ts')};
			`
		);
		// the `type` modifier survives when a leaf gets both kinds
		f.write('lib/mixed.ts', 'export const v = 1; export type V = 1;');
		f.write('lib/index.ts', `export { v, type V } from './mixed';`);
		f.write('src/mixed.ts', `import { v, type V } from '$lib';`);
		expect(await f.rewrite('src/mixed.ts')).toBe(
			`import { v, type V } from ${q(f, 'lib/mixed.ts')};`
		);
	});

	it('a namespace re-export becomes `import * as`', async () => {
		f = fixture({ ...base(), 'src/app.ts': `import { ns } from '$lib';` });
		expect(await f.rewrite('src/app.ts')).toBe(`import * as ns from ${q(f, 'lib/ns.ts')};`);
	});

	it('`import { default as X }` is a named default; two aliases of one leaf default get two lines', async () => {
		f = fixture({
			'lib/d.ts': 'export default 1;',
			'lib/index.ts': `export { default } from './d';\nexport { default as D2 } from './d';`,
			'src/app.ts': `import { default as X, D2 } from '$lib';`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			`import X from ${q(f, 'lib/d.ts')};\nimport D2 from ${q(f, 'lib/d.ts')};`
		);
	});

	it('a default import of the barrel is rewritten only when the barrel re-exports its default', async () => {
		f = fixture({
			'lib/d.ts': 'export default 1; export const n = 2;',
			'lib/index.ts': `export { default, n } from './d';`,
			'src/app.ts': `import D, { n } from '$lib';`
		});
		expect(await f.rewrite('src/app.ts')).toBe(`import D, { n } from ${q(f, 'lib/d.ts')};`);
	});

	it('what cannot move stays on the barrel: unknown names, own names of a forced barrel, ambiguous names', async () => {
		f = fixture({
			'lib/x.ts': 'export const same = 1; export const x = 1;',
			'lib/y.ts': 'export const same = 2;',
			'lib/index.ts': dedent`
				export * from './x';
				export * from './y';
				export const own = 3;
			`,
			'src/app.ts': `import { x, same, own, nope } from '$lib';`
		});
		expect(await f.rewrite('src/app.ts'), 'impure + not forced → untouched').toBeNull();
		expect(await f.rewrite('src/app.ts', { forced: () => true })).toBe(
			`import { x } from ${q(f, 'lib/x.ts')};\nimport { same, own, nope } from '$lib';`
		);
	});

	it('a forced impure barrel whose names all moved keeps a bare import so its own code still runs', async () => {
		f = fixture({
			'lib/leaf.ts': 'export const l = 1;',
			'lib/index.ts': `export { l } from './leaf';\nregisterAll();`,
			'src/app.ts': `import { l } from '$lib' with { type: 'x' };`
		});
		expect(await f.rewrite('src/app.ts', { forced: () => true })).toBe(
			`import { l } from ${q(f, 'lib/leaf.ts')} with { type: 'x' };\nimport '$lib' with { type: 'x' };`
		);
	});

	it('untouched by design: `import * as B`, `import "barrel"`, dynamic import; a default the barrel OWNS stays', async () => {
		f = fixture({
			'lib/leaf.ts': 'export const l = 1;',
			'lib/index.ts': `export { l } from './leaf';\nexport default 1;`,
			'src/ns.ts': `import * as B from '$lib';`,
			'src/side.ts': `import '$lib';`,
			'src/dyn.ts': `const m = await import('$lib');`
		});
		const forced = { forced: () => true };
		expect(await f.rewrite('src/ns.ts', forced)).toBeNull();
		expect(await f.rewrite('src/side.ts', forced)).toBeNull();
		expect(await f.rewrite('src/dyn.ts', forced)).toBeNull();
		f.write('src/def.ts', `import D, { l } from '$lib';`);
		expect(await f.rewrite('src/def.ts', forced)).toBe(
			`import { l } from ${q(f, 'lib/leaf.ts')};\nimport D from '$lib';`
		);
	});

	it('two imports of the same barrel in one file are both rewritten; other imports are left byte-identical', async () => {
		f = fixture({
			...base(),
			'src/app.ts': dedent`
				import fs from 'node:fs';
				import { a } from '$lib';
				import { helper } from './helper';
				import { Button } from '$lib';
				export const x = a;
			`,
			'src/helper.ts': 'export const helper = 1;'
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			dedent`
				import fs from 'node:fs';
				import { a } from ${q(f, 'lib/a.ts')};
				import { helper } from './helper';
				import Button from ${q(f, 'lib/Button.svelte')};
				export const x = a;
			`
		);
	});

	it('an importer that is itself a barrel gets rewritten too (a barrel of barrels flattens one level per file)', async () => {
		f = fixture({
			'lib/leaf.ts': 'export const l = 1;',
			'lib/inner/index.ts': `export { l } from '../leaf';`,
			'lib/index.ts': `import { l } from './inner';\nexport { l };`
		});
		expect(await f.rewrite('lib/index.ts')).toBe(
			`import { l } from ${q(f, 'lib/leaf.ts')};\nexport { l };`
		);
	});

	it('cursed spellings: no semicolons, no spaces, comments and newlines inside the braces, unicode, string export names on both sides', async () => {
		f = fixture({
			'lib/a.ts':
				'export const a = 1; export const ünï = 2; export const k = 3; const s = 4; export { s as "str-name" };',
			'lib/index.ts': dedent`
				export { a, ünï } from './a';
				export { k as "kebab-name" } from './a';
				export { "str-name" as viaString } from './a';
			`,
			'src/app.ts': dedent`
				import{a}from"$lib"
				import {
				  /* leading */ ünï, // trailing
				} from '$lib'
				import { "kebab-name" as kebab, viaString } from '$lib';
				const z = 1
			`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			dedent`
				import { a } from ${q(f, 'lib/a.ts')};
				import { ünï } from ${q(f, 'lib/a.ts')};
				import { k as kebab, "str-name" as viaString } from ${q(f, 'lib/a.ts')};
				const z = 1
			`
		);
	});

	it('a leaf path with a quote in it is escaped in the emitted import', async () => {
		f = fixture({
			"lib/it's/a.ts": 'export const a = 1;',
			'lib/index.ts': `export { a } from "./it's/a";`,
			'src/app.ts': `import { a } from '$lib';`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			`import { a } from '${f.id("lib/it's/a.ts").replace("'", "\\'")}';`
		);
	});

	it('returns null (no work) for a file that imports no barrel, and for a syntax error', async () => {
		f = fixture({
			'src/plain.ts': `import fs from 'node:fs'; export const x = 1;`,
			'src/broken.ts': `import { from 'x'`
		});
		expect(await f.rewrite('src/plain.ts')).toBeNull();
		expect(await f.rewrite('src/broken.ts')).toBeNull();
	});

	it('a barrel imported through two different specifiers (alias and relative) is the same barrel', async () => {
		f = fixture({
			...base(),
			'src/app.ts': `import { a } from '$lib';\nimport { bee } from '../lib/index';`
		});
		expect(await f.rewrite('src/app.ts')).toBe(
			`import { a } from ${q(f, 'lib/a.ts')};\nimport { b as bee } from ${q(f, 'lib/a.ts')};`
		);
	});

	it('emits a high-resolution sourcemap that still maps the untouched tail of the file', async () => {
		f = fixture({
			...base(),
			'src/app.ts': dedent`
				import { a } from '$lib';

				export const tail = a + 1;
			`
		});
		const i = f.index();
		const importer = f.id('src/app.ts');
		const code = f.read('src/app.ts');
		const ms = new MagicString(code);
		const moves = await rewrite_imports(code, importer, f.lookup(i, importer), ms);
		expect(ms.generateMap({ hires: true }).mappings.length).toBeGreaterThan(0);
		expect(ms.toString().endsWith('export const tail = a + 1;')).toBe(true);
		expect(moves).toEqual([
			{ barrel: f.id('lib/index.ts'), names: ['a'], leaves: [f.id('lib/a.ts')] }
		]);
	});
});
