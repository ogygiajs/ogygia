import { describe, test, expect } from 'vitest';
import { island_imports } from '../src/link/island-imports.ts';
import { dedent } from '@ogygia/core/contract';

describe('the imports a module makes at run time', () => {
	test('a script’s static imports, re-exports, bare imports and literal import()s, each once', () => {
		const src = dedent`
			import a from './a.js';
			import { b } from './b.js';
			import './side.js';
			export * from './all.js';
			export { c } from './c.js';
			import again from './a.js';
			const lazy = () => import('./lazy.js');
			const tick = () => import(\`./tick.js\`);
			const nav = () => import('$app/navigation');
		`;
		expect(island_imports(src, '/x/mod.js')).toEqual([
			'./a.js',
			'./b.js',
			'./side.js',
			'./all.js',
			'./c.js',
			'./lazy.js',
			'./tick.js',
			'$app/navigation'
		]);
	});

	test('an import in a comment, a type-only import and a computed import() are none', () => {
		const src = dedent`
			// import gone from 'commented';
			/** import { tryLogin } from '$lib/server/auth' */
			import type { T } from 'types';
			import { type U } from 'types-inline';
			export type { V } from 'types-export';
			import { w, type W } from './mixed.ts';
			const pick = (name: string) => import(name);
			const spliced = (n: string) => import(\`./x/\${n}.js\`);
			export const v: T | U | W = w;
		`;
		expect(island_imports(src, '/x/mod.ts')).toEqual(['./mixed.ts']);
	});

	test('a component’s imports in both scripts and its template, but not in a comment', () => {
		const src = dedent`
			<script module lang="ts">
			export * from './shared.ts';
			export type { T } from './types.ts';
			</script>
			<script lang="ts">
			// import Gone from './Gone.svelte';
			import type { P } from './props.ts';
			import Child from './Child.svelte';
			let { p }: { p: P } = $props();
			</script>
			<!-- import Hidden from './Hidden.svelte' -->
			<Child />
			{#await import('./Lazy.svelte') then m}<m.default />{/await}
		`;
		expect(island_imports(src, '/x/Mod.svelte')).toEqual([
			'./shared.ts',
			'./Child.svelte',
			'./Lazy.svelte'
		]);
	});

	test('a component with no import() in its markup reads the same from its scripts alone', () => {
		const src = dedent`
			<!-- import Hidden from './Hidden.svelte' -->
			<script module>
			export { helper } from './helper.js';
			</script>
			<script lang="ts">
			import type { P } from './props.ts';
			import Child from './Child.svelte';
			const go = async () => (await import('$app/navigation')).goto('/');
			</script>
			<Child onclick={go} />
		`;
		expect(island_imports(src, '/x/Mod.svelte')).toEqual([
			'./helper.js',
			'./Child.svelte',
			'$app/navigation'
		]);
	});

	test('a module that does not parse gives the specifiers it spells', () => {
		expect(island_imports(`import a from './a.js';\nconst = ;`, '/x/broken.js')).toEqual([
			'./a.js'
		]);
	});
});
