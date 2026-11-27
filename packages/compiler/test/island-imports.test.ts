import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import { island_imports } from '../src/link/island-imports.ts';
import { dedent } from '@ogygia/core/contract';

async function built_with(verbatim: boolean): Promise<{ code: string; imports: string[] }> {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-verbatim-')));
	try {
		const write = (rel: string, text: string) => fs.writeFileSync(path.join(root, rel), text);
		write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
		write(
			'tsconfig.json',
			JSON.stringify({ compilerOptions: { verbatimModuleSyntax: verbatim, module: 'esnext' } })
		);
		const entry = dedent`
			import { type A } from './typed.ts';
			export const a: A | null = null;
		`;
		write('entry.ts', `${entry}\n`);
		write(
			'typed.ts',
			`${dedent`
				console.log('typed.ts ran');
				export type A = number;
			`}\n`
		);
		const out = (await build({
			root,
			configFile: false,
			logLevel: 'silent',
			build: {
				write: false,
				minify: false,
				lib: { entry: path.join(root, 'entry.ts'), formats: ['es'], fileName: 'entry' }
			}
		})) as Rollup.RolldownOutput[];
		const code = out[0].output.map((o) => (o.type === 'chunk' ? o.code : '')).join('\n');
		return { code, imports: island_imports(entry, path.join(root, 'entry.ts')) };
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

describe('the walk follows every module the bundler loads', () => {
	test('with verbatimModuleSyntax on, the bundler runs a module whose imported names are each `type`, and the walk follows it', async () => {
		const on = await built_with(true);
		expect(on.code).toContain('typed.ts ran');
		expect(on.imports).toEqual(['./typed.ts']);
		const off = await built_with(false);
		expect(off.code).not.toContain('typed.ts ran');
	}, 60_000);
});

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

	test('an import in a comment, a whole-statement `import type` or `export type` and a computed import() are none', () => {
		const src = dedent`
			// import gone from 'commented';
			/** import { tryLogin } from '$lib/server/auth' */
			import type { T } from 'types';
			import type D from 'types-default';
			export type { V } from 'types-export';
			export type * from 'types-export-all';
			import { w, type W } from './mixed.ts';
			const pick = (name: string) => import(name);
			const spliced = (n: string) => import(\`./x/\${n}.js\`);
			export const v: T | D | W = w;
		`;
		expect(island_imports(src, '/x/mod.ts')).toEqual(['./mixed.ts']);
	});

	test('an import or re-export whose names are each `type` still loads its module, as it does with verbatimModuleSyntax', () => {
		const src = dedent`
			import { type U } from 'types-inline';
			export { type X } from 'types-export-inline';
			import type from 'a-default-named-type';
			export const u: U | null = null;
		`;
		expect(island_imports(src, '/x/mod.ts')).toEqual([
			'types-inline',
			'a-default-named-type',
			'types-export-inline'
		]);
		const component = dedent`
			<script lang="ts">
			import { type P } from './props.ts';
			let { p }: { p: P } = $props();
			</script>
			{#await import('./Lazy.svelte') then m}<m.default {p} />{/await}
		`;
		expect(island_imports(component, '/x/Mod.svelte')).toEqual(['./props.ts', './Lazy.svelte']);
		expect(
			island_imports(component.replace(/\{#await[^]*$/, '<p>{p}</p>'), '/x/Mod.svelte')
		).toEqual(['./props.ts']);
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
