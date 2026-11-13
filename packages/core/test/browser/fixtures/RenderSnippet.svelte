<script lang="ts">
	// Renders the one snippet it is handed: how a test sees what a revived region snippet puts down.
	import type { Snippet } from 'svelte';
	let { s }: { s: Snippet } = $props();
</script>

{@render s()}
