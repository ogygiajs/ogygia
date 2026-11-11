<script lang="ts">
	import type { Component } from 'svelte';
	import type { BlockData } from '$lib/page-data.ts';

	// the same markup as /p/[n]: the bench checks the two answer the same HTML
	let { data }: { data: { n: number; blocks: (BlockData & { C: Component<never> })[] } } = $props();
</script>

<h1>Page {data.n}</h1>
{#each data.blocks as block, i (i)}
	{@const Block = block.C as unknown as Component<{ title: string; items: BlockData['items'] }>}
	<Block title={block.title} items={block.items} />
{/each}
