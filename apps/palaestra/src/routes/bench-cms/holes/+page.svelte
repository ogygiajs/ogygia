<script lang="ts">
	import CmsShell from '$lib/bench/CmsShell.svelte';
	import HoleLoad from '$lib/bench/BigHole.svelte' with { render: 'deferred' };
	import HoleVisible from '$lib/bench/BigHole.svelte' with { render: 'deferred', fetch: 'visible' };
	let { data } = $props();
</script>

<svelte:head><title>bench: CMS shape (big holes)</title></svelte:head>

<HoleLoad cards={50} tag="top">
	{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}
</HoleLoad>
<CmsShell page={data}>
	<HoleVisible cards={125} tag="a">
		{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}
	</HoleVisible>
	<HoleVisible cards={125} tag="b">
		{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}
	</HoleVisible>
</CmsShell>
