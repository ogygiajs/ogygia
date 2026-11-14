<script lang="ts">
	import { greet } from '$lib/greet.remote';
	import Card from '$lib/Card.svelte';
</script>

<Card>{await greet('server')}</Card>

<style>
	:global(body) {
		color: rebeccapurple;
	}
</style>
