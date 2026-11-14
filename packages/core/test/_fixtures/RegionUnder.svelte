<script lang="ts">
	import { untrack } from 'svelte';
	import Region from '../../src/Region.svelte';
	let { setup, regions }: { setup?: () => void; regions: Record<string, unknown>[] } = $props();
	untrack(() => setup?.());
</script>

{#each regions as r, i (i)}<Region {...r} />{/each}
