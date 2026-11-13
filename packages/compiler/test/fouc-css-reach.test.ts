// The CSS a component tree reaches, through script modules: a barrel brings the CSS of the names
// taken, a module with code of its own brings everything it imports or re-exports, a dependency's own
// JavaScript and a type-only import bring nothing, and a component outside the app's root never rides
// the fouc module (its dev `load` refuses `..`). Then the parse the walk reads imports with.
import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import {
	buildFoucCssModuleSource,
	collectFoucCssReachable,
	foucScopedVirtualId,
	listStaticImports
} from '../src/compiler/fouc-css.ts';

const styled = (cls: string) => `<i class="${cls}"></i><style>.${cls} { color: red }</style>`;
const LIB = '/app/src/lib';

const reach = async (files: Record<string, string>, resolve?: Record<string, string>) => {
	const read = (p: string) => files[path.normalize(p)] ?? null;
	const reached = await collectFoucCssReachable(`${LIB}/Page.svelte`, {
		root: '/app',
		libDir: LIB,
		readFile: read,
		resolve: async (spec, importer) => {
			if (resolve?.[spec]) return resolve[spec];
			const base = path.resolve(path.dirname(importer), spec);
			for (const s of ['', '.ts', '/index.ts']) if (read(base + s) != null) return base + s;
			return null;
		}
	});
	return reached.map((e) => path.basename(e.abs)).sort();
};

const BITS = {
	[`${LIB}/bits/index.ts`]: dedent`
		export { default as A } from './A.svelte';
		export { default as B } from './B.svelte';
	`,
	[`${LIB}/bits/A.svelte`]: styled('a'),
	[`${LIB}/bits/B.svelte`]: styled('b')
};

describe('a barrel brings the CSS of what is taken from it', () => {
	test('a namespace import takes every name', async () => {
		const files = {
			...BITS,
			[`${LIB}/Page.svelte`]: `<script>import * as bits from './bits';</script><bits.A />`
		};
		expect(await reach(files)).toEqual(['A.svelte', 'B.svelte']);
	});

	test('a namespace re-export taken by name brings the whole namespace', async () => {
		const files = {
			...BITS,
			[`${LIB}/outer.ts`]: `export * as bits from './bits';`,
			[`${LIB}/Page.svelte`]: `<script>import { bits } from './outer';</script><bits.A />`
		};
		expect(await reach(files)).toEqual(['A.svelte', 'B.svelte']);
	});

	test("a barrel's own code taken by name brings everything the barrel imports", async () => {
		const files = {
			...BITS,
			[`${LIB}/C.svelte`]: styled('c'),
			[`${LIB}/mixed.ts`]: dedent`
				import C from './C.svelte';
				export { default as A } from './bits/A.svelte';
				export const pickC = () => C;
			`,
			[`${LIB}/Page.svelte`]: `<script>import { pickC } from './mixed';</script>{pickC()}`
		};
		expect(await reach(files)).toEqual(['A.svelte', 'C.svelte']);
	});

	test('a barrel with a star it cannot follow brings everything it reaches', async () => {
		const files = {
			...BITS,
			[`${LIB}/C.svelte`]: styled('c'),
			[`${LIB}/opaque.ts`]: dedent`
				export { default as A } from './bits/A.svelte';
				export { default as C } from './C.svelte';
				export * from './missing';
			`,
			[`${LIB}/Page.svelte`]: `<script>import { A } from './opaque';</script><A />`
		};
		expect(await reach(files)).toEqual(['A.svelte', 'C.svelte']);
	});

	test('a type-only name taken from a barrel brings nothing more', async () => {
		const files = {
			...BITS,
			[`${LIB}/pick.ts`]: dedent`
				import { type T, A } from './bits';
				export const pick = (t?: T) => A;
			`,
			[`${LIB}/Page.svelte`]: `<script>import { pick } from './pick';</script>{pick()}`
		};
		expect(await reach(files)).toEqual(['A.svelte']);
	});
});

describe('a module with code of its own', () => {
	test('brings what it re-exports, by name, by star and by namespace', async () => {
		const files = {
			[`${LIB}/R.svelte`]: styled('r'),
			[`${LIB}/more/index.ts`]: `export { default as M } from './M.svelte';`,
			[`${LIB}/more/M.svelte`]: styled('m'),
			[`${LIB}/ns/index.ts`]: `export { default as N } from './N.svelte';`,
			[`${LIB}/ns/N.svelte`]: styled('n'),
			[`${LIB}/own.ts`]: dedent`
				export { default as R } from './R.svelte';
				export * from './more';
				export * as ns from './ns';
				export const x = 1;
			`,
			[`${LIB}/Page.svelte`]: `<script>import { x } from './own';</script>{x}`
		};
		expect(await reach(files)).toEqual(['M.svelte', 'N.svelte', 'R.svelte']);
	});

	test('a type-only import brings nothing', async () => {
		const files = {
			[`${LIB}/T.svelte`]: styled('t'),
			[`${LIB}/pick.ts`]: dedent`
				import type T from './T.svelte';
				export const pick = (t?: T) => t;
			`,
			[`${LIB}/Page.svelte`]: `<script>import { pick } from './pick';</script>{pick()}`
		};
		expect(await reach(files)).toEqual([]);
	});

	test("a dependency's own JavaScript is not walked", async () => {
		const files = {
			'/app/node_modules/pkg/A.svelte': styled('a'),
			'/app/node_modules/pkg/index.js': dedent`
				import A from './A.svelte';
				export const pick = () => A;
			`,
			[`${LIB}/Page.svelte`]: `<script>import { pick } from 'pkg';</script>{pick()}`
		};
		expect(await reach(files, { pkg: '/app/node_modules/pkg/index.js' })).toEqual([]);
	});
});

describe('the fouc module', () => {
	test('a styled component outside the app root is left out', async () => {
		const files: Record<string, string> = {
			[`${LIB}/Page.svelte`]: `<script>import O from '../../../outside/O.svelte';</script><O />`,
			'/outside/O.svelte': styled('o')
		};
		const src = await buildFoucCssModuleSource(`${LIB}/Page.svelte`, {
			root: '/app',
			libDir: LIB,
			readFile: (p) => files[path.normalize(p)] ?? null
		});
		expect(src).toBe('export {}');
		expect(src).not.toContain(foucScopedVirtualId('../outside/O.svelte'));
	});
});

describe("a component's static imports", () => {
	test('a style the markup parser cannot read does not lose the names taken', () => {
		const src = dedent`
			<script>import { A } from './bits';</script>
			<A />
			<style lang="scss">$c: red; .a { color: $c; }</style>
		`;
		expect(listStaticImports(src, `${LIB}/S.svelte`)).toEqual([
			{ source: './bits', names: new Set(['A']) }
		]);
	});

	test('markup that does not parse still yields its imports, every name taken', () => {
		const src = `<script>import A from './A.svelte';</script>{#if}`;
		expect(listStaticImports(src, `${LIB}/S.svelte`)).toEqual([
			{ source: './A.svelte', names: new Set(['*']) }
		]);
	});
});
