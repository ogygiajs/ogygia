<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<article>{@render children()}</article>

<style>
	article {
		border: 1px solid;
	}
</style>
