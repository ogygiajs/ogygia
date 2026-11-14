<script lang="ts">
	import type { Snippet } from 'svelte';

	let { snippet }: { snippet: Snippet } = $props();
</script>

{@render snippet()}
