<script>
	import { registry, BLOCK_NAMES } from '$lib/registry.ts';
	import { page_blocks } from '$lib/page-data.js';

	let { data } = $props();
	const blocks = $derived(page_blocks(data.n, BLOCK_NAMES));
</script>

<h1>Page {data.n}</h1>
{#each blocks as block, i (i)}
	{@const Block = registry[block.type]}
	<Block title={block.title} items={block.items} />
{/each}
