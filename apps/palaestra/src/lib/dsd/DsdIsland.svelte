<script lang="ts">
	import { browser } from '$app/environment';
	import { card_shadow } from './shadow';
	import './badge';

	let { label }: { label: string } = $props();
	let clicks = $state(0);
</script>

<x-card data-dsd-island
	>{@html browser ? '' : card_shadow(label)}<button data-dsd-click onclick={() => clicks++}
		>clicked {clicks}</button
	></x-card
>
