<script lang="ts">
	import type { Snippet } from 'svelte';
	let { s }: { s?: Snippet } = $props();
</script>

<span data-snippet-prop>{@render s?.()}</span>
