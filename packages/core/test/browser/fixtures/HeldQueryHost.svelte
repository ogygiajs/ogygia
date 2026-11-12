<script lang="ts">
	// An island holding a held region awaited in the render (what an async-mode app's
	// `<Region of={query()}>` compiles to), shown while `show` holds.
	import PromiseRegionAwait from '../../../src/PromiseRegionAwait.svelte';
	import type { RegionValue } from '../../../src/region.ts';

	let { query }: { query: () => Promise<RegionValue> } = $props();
	let show = $state(true);
	export const hide = () => (show = false);
</script>

{#if show}
	<PromiseRegionAwait of={query()}>
		{#snippet placeholder()}<p>loading</p>{/snippet}
	</PromiseRegionAwait>
{/if}
