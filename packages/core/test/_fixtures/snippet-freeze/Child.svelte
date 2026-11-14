<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title = '', children }: { title?: string; children?: Snippet } = $props();
</script>

<svelte:head><meta name="child" content={title} /></svelte:head>

<section class="child" {title}>{@render children?.()}</section>

<style>
	.child {
		margin: 1px;
	}
</style>
