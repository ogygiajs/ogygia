<script lang="ts">
	import DsdIsland from '$lib/dsd/DsdIsland.svelte' with { wake: 'load' };
	import { card_shadow } from '$lib/dsd/shadow';
</script>

<svelte:head><title>dsd A</title></svelte:head>

<h1 data-dsd-heading>DSD A</h1>

<x-card data-dsd-kept>{@html card_shadow('kept A')}<span>light A</span></x-card>

<x-card id="dsd-keyed-a" data-dsd-keyed>{@html card_shadow('keyed A')}</x-card>

<DsdIsland label="island A" />

<p><a href="/dsd/b" data-dsd-to-b>to B</a></p>
