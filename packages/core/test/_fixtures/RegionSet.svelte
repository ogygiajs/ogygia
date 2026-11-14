<script lang="ts">
	import { untrack } from 'svelte';
	import Region from '../../src/Region.svelte';

	let { first }: { first: Record<string, unknown> } = $props();
	let r = $state.raw(untrack(() => first));
	export const set = (next: Record<string, unknown>): void => {
		r = next;
	};
</script>

<Region {...r} />
