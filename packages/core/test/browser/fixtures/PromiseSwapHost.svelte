<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { RegionValue } from '../../../src/region.ts';

	let {
		held: Held,
		first
	}: {
		held: Component<{ of: Promise<RegionValue>; placeholder?: Snippet }>;
		first: Promise<RegionValue>;
	} = $props();
	// svelte-ignore state_referenced_locally
	let of = $state(first);
	export const swap = (next: Promise<RegionValue>): void => {
		of = next;
	};
</script>

{#snippet waiting()}<p>loading</p>{/snippet}

<Held {of} placeholder={waiting} />
