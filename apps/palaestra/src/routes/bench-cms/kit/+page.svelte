<script lang="ts">
	// The large CMS page as a csr=true product page: a header and a footer lake (7 islands and 4 holes
	// inside them) and a few hundred web components that render into their light DOM before Kit
	// hydrates. What Kit's hydration costs here, and what the runtime adds: the TBT blame study.
	import CmsShell from '$lib/bench/CmsShell.svelte';
	import Lake from '$lib/bench/KitLake.svelte' with { wake: 'none' };
	import { X_WIDGET_SCRIPT } from '$lib/bench/x-widget';
	let { data } = $props();
	const widgets = Array.from({ length: 220 }, (_, i) => i);
</script>

<svelte:head>
	<title>bench: CMS shape (Kit-hydrated)</title>
	{@html X_WIDGET_SCRIPT}
</svelte:head>

<Lake tag="header" idle={2} load={1} />
<CmsShell page={data}>
	<div data-widgets>
		{#each widgets as i (i)}
			<x-widget><p>widget <strong>{i}</strong></p></x-widget>
		{/each}
	</div>
</CmsShell>
<Lake tag="footer" idle={2} load={1} visible={1} />
