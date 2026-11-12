<!--
@component
Renders a page tree of blocks: each block becomes a region and renders through `<Region>`, and its
children render inside it. Pass a `tree` with the `registry` that maps each block `type` to a
`with { region: 'raw' }` import, or a `nodes` list `resolve_block_tree` already made (a `blocks()`
collection body does that). A block whose `type` the registry lacks is left out.
-->
<script lang="ts">
	import { Region } from '@ogygia/core';
	import Self from './Blocks.svelte';
	import { resolve_block_tree } from './blocks.ts';
	import type { BlockNode, BlockRegistry, BlockSchedule, ResolvedBlockNode } from './blocks.ts';

	let {
		tree,
		registry,
		schedule,
		nodes: resolved
	}: {
		tree?: BlockNode | BlockNode[] | null;
		registry?: BlockRegistry;
		schedule?: BlockSchedule;
		/** Already resolved: rendered as given, ahead of `tree`, with no registry needed. */
		nodes?: ResolvedBlockNode[];
	} = $props();

	const nodes = $derived(resolved ?? resolve_block_tree(tree, registry ?? {}, schedule));
</script>

{#each nodes as node, i (i)}
	<Region of={node.of}
		>{#if node.children && node.children.length}<Self nodes={node.children} />{/if}</Region
	>
{/each}
