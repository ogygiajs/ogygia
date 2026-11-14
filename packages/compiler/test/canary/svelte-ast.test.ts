/**
 * CANARY (#1722): the shapes of Svelte's modern template AST that ogygia's compiler walks
 * (src/parse/svelte-ast.ts names each node type and field). The AST is public but still changes
 * shape between Svelte versions.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'svelte/compiler';
import { SVELTE_AST_READS } from '../../src/parse/svelte-ast.ts';
import { broke, type Internal } from '../../../core/test/canary/upstream.ts';

const AST: Internal = {
	upstream: "Svelte's modern template AST (`svelte/compiler` parse)",
	used_by: [
		'packages/compiler/src/parse/svelte-ast.ts',
		'packages/compiler/src/free-vars.ts',
		'packages/compiler/src/region/transform.ts',
		'packages/compiler/src/region/marked-imports.ts',
		'packages/compiler/src/ownership-stamps.ts',
		'packages/barrels/src/svelte.ts',
		'packages/tsdown-plugin-svelte/src/strip-ts.ts'
	],
	issue: 1722
};

/** One component that holds every node the table names. */
const EVERY_NODE = `<script module>
	export const m = 1;
</script>
<script>
	import Child from './Child.svelte';
	let { items = [], p, el = 'div', C, children } = $props();
	const act = () => {};
	const fade = () => ({});
	const flip = () => ({});
	const attach = () => {};
</script>

<svelte:head><title>{p}</title></svelte:head>
<svelte:body onclick={act} />
<svelte:document onkeydown={act} />
<svelte:window onresize={act} />
<svelte:options runes />

<!-- a comment -->
<p class="a" {...p} bind:value={p} onclick={act} use:act transition:fade style:color={p} {@attach attach}>
	text {p} {@html p}
</p>
{#if p}<b>1</b>{:else}<i>2</i>{/if}
{#each items as item, i (item)}<span animate:flip on:click={act}>{item}{i}</span>{:else}<i>none</i>{/each}
{#await p}<i>wait</i>{:then v}{v}{:catch e}{e}{/await}
{#key p}<b>k</b>{/key}
{#snippet row(x)}{@const y = x}{y}{@debug y}{/snippet}
{@render row(p)}
<Child let:x><svelte:fragment slot="s">{x}</svelte:fragment></Child>
<svelte:component this={C} />
<svelte:element this={el} />
<svelte:self />
<svelte:boundary><b>safe</b></svelte:boundary>
<slot name="s" />
<style>p { color: red; }</style>
`;

/** Every node in the tree by its `type`, the template's and the scripts'. */
function by_type(root: unknown): Map<string, Record<string, unknown>[]> {
	const out = new Map<string, Record<string, unknown>[]>();
	const seen = new Set<unknown>();
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) return node.forEach(walk);
		const n = node as Record<string, unknown>;
		if (typeof n.type === 'string') {
			let list = out.get(n.type);
			if (!list) out.set(n.type, (list = []));
			list.push(n);
		}
		for (const key in n) if (key !== 'parent' && key !== 'metadata') walk(n[key]);
	};
	walk(root);
	return out;
}

const svelte = path.dirname(createRequire(import.meta.url).resolve('svelte/package.json'));

/** The template node types the installed Svelte declares (its `AST` namespace, past JS's `Line`). */
function declared_types(): Set<string> {
	const dts = fs.readFileSync(path.join(svelte, 'types/index.d.ts'), 'utf8');
	const start = dts.indexOf('export namespace AST {');
	const end = dts.indexOf('namespace _CSS', start);
	const names = [...dts.slice(start, end).matchAll(/type: '([A-Za-z]+)'/g)].map((m) => m[1]);
	return new Set(names.filter((n) => n !== 'Line'));
}

const WALKERS = [
	'packages/compiler/src',
	'packages/barrels/src',
	'packages/tsdown-plugin-svelte/src',
	'packages/cli/src'
];
const ROOT = path.resolve(import.meta.dirname, '../../../..');

function sources(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? sources(p) : e.name.endsWith('.ts') ? [p] : [];
	});
}

describe("the Svelte AST the compiler walks, from the installed Svelte's parse", () => {
	const nodes = by_type(parse(EVERY_NODE, { modern: true, filename: 'Every.svelte' }));

	it.each(Object.entries(SVELTE_AST_READS))('%s has the fields ogygia reads', (type, fields) => {
		const found = nodes.get(type);
		expect(
			found?.length,
			broke(AST, `a \`${type}\` node no longer comes out of parse`)
		).toBeTruthy();
		for (const field of fields)
			expect(
				found!.some((n) => field in n),
				broke(AST, `a \`${type}\` node has no \`${field}\``)
			).toBe(true);
	});

	it('every template node type a walker names is in the table, so it has a canary', () => {
		const declared = declared_types();
		const missing: string[] = [];
		for (const dir of WALKERS)
			for (const file of sources(path.join(ROOT, dir))) {
				if (file.endsWith('svelte-ast.ts')) continue;
				for (const m of fs.readFileSync(file, 'utf8').matchAll(/'([A-Z][A-Za-z]+)'/g))
					if (declared.has(m[1]) && !(m[1] in SVELTE_AST_READS))
						missing.push(`${path.relative(ROOT, file)}: ${m[1]}`);
			}
		expect(
			[...new Set(missing)],
			'add each node type to packages/compiler/src/parse/svelte-ast.ts, with the fields read on it'
		).toEqual([]);
	});
});
