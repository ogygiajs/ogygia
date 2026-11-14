<script lang="ts">
	import type { Snippet } from 'svelte';
	let { s }: { s: Snippet<[string]> } = $props();
</script>

{@render s('raw')}
