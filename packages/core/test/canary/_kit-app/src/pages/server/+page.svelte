<script lang="ts">
	import { page } from '$app/state';
	import { greet } from '$lib/greet.remote';
	import Card from '$lib/Card.svelte';
	import Unrendered from '$lib/Unrendered.svelte';

	const blocks = { card: Card, unrendered: Unrendered };
	const Block = $derived(
		blocks[page.url.searchParams.get('block') === 'unrendered' ? 'unrendered' : 'card']
	);
</script>

<Block>{await greet('server')}</Block>

<style>
	:global(body) {
		color: rebeccapurple;
	}
</style>
