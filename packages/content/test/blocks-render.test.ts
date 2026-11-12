// <Blocks>: a tree with its registry and an already-resolved `nodes` list render the same regions,
// and a block's children render inside it.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Blocks from '../src/Blocks.svelte';
import { resolve_block_tree, type BlockNode } from '../src/blocks.ts';
import Block from './fixtures/Block.svelte';

// A `with { region: 'raw' }` SSR-leg binding, as the transform generates it.
function binding(id: string) {
	return {
		__ogRegion: id,
		__module: `/_app/immutable/og-region.${id}.js`,
		__component: Block as unknown as Component<Record<string, unknown>>,
		__sign: () => `./__ogygia__?id=${id}&sig=x`
	};
}

const registry = { Hero: binding('a1'), Grid: binding('b2'), Feature: binding('c3') };
const tree: BlockNode[] = [
	{ type: 'Hero', props: { name: 'hero', title: 'hi' } },
	{
		type: 'Grid',
		props: { name: 'grid' },
		children: [
			{ type: 'Feature', props: { name: 'one' } },
			{ type: 'Feature', props: { name: 'two' } }
		]
	}
];

async function html(props: Record<string, unknown>) {
	const { body } = await render(Blocks as unknown as Component<Record<string, unknown>>, {
		props
	});
	return body.replace(/<!--[^>]*-->/g, ''); // the hydration markers
}

const EXPECTED = `<section data-block="hero">hi</section><section data-block="grid"><section data-block="one"></section><section data-block="two"></section></section>`;

describe('Blocks', () => {
	it('renders each block of a tree through its registry entry, children inside their parent', async () => {
		expect(await html({ tree, registry })).toBe(EXPECTED);
	});

	it('renders an already-resolved `nodes` list the same, with no registry', async () => {
		expect(await html({ nodes: resolve_block_tree(tree, registry) })).toBe(EXPECTED);
	});

	it('takes `nodes` over `tree` when both are given', async () => {
		const nodes = resolve_block_tree([{ type: 'Hero', props: { name: 'resolved' } }], registry);
		expect(await html({ nodes, tree, registry })).toBe('<section data-block="resolved"></section>');
	});

	it('leaves out a block whose type is not in the registry, and keeps the rest', async () => {
		const body = await html({
			tree: [{ type: 'Nope', props: { name: 'nope' } }, ...tree],
			registry
		});
		expect(body).toBe(EXPECTED);
	});

	it('takes a single node, and renders nothing for no tree', async () => {
		expect(await html({ tree: tree[0], registry })).toBe('<section data-block="hero">hi</section>');
		expect(await html({ tree: null, registry })).toBe('');
		expect(await html({})).toBe('');
	});
});
