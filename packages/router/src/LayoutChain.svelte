<script lang="ts">
	import type { Component } from 'svelte';

	type AnyComponent = Component<Record<string, unknown>>;

	interface Props {
		chain: AnyComponent[];
		component: AnyComponent;
		props: Record<string, unknown>;
		data: unknown;
		fallback?: AnyComponent;
	}

	let { chain, component: Page, props, data, fallback: Fallback }: Props = $props();
</script>

{#snippet nest(i: number)}
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
