<script>
	let { chain, component: Page, props, data, fallback: Fallback } = $props();
</script>

{#snippet nest(i)}
	{#if i < chain.length}
		{@const Layout = chain[i]}
		<Layout {data}>{@render nest(i + 1)}</Layout>
	{:else if Fallback}
		<Page {...props}>
			{#snippet ogygiaFallback()}<Fallback {data} />{/snippet}
		</Page>
	{:else}
		<Page {...props} />
	{/if}
{/snippet}

{@render nest(0)}
