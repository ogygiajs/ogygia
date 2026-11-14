<script lang="ts">
	import DsdIsland from '$lib/dsd/DsdIsland.svelte' with { wake: 'load' };
	import { card_shadow } from '$lib/dsd/shadow';
</script>

<svelte:head><title>dsd B</title></svelte:head>

<h1 data-dsd-heading>DSD B</h1>

<x-card data-dsd-kept>{@html card_shadow('kept B')}<span>light B</span></x-card>

<x-card id="dsd-keyed-b" data-dsd-keyed>{@html card_shadow('keyed B')}</x-card>

<section data-dsd-only-b>
	<x-card data-dsd-new>{@html card_shadow('new B')}<span>only on B</span></x-card>
</section>

<DsdIsland label="island B" />

<p><a href="/dsd" data-dsd-to-a>to A</a></p>
