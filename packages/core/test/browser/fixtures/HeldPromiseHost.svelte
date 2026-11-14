<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { RegionValue } from '../../../src/region.ts';

	let {
		held: Held,
		of,
		boundary
	}: {
		held: Component<{ of: Promise<RegionValue>; placeholder?: Snippet }>;
		of: Promise<RegionValue>;
		boundary: boolean;
	} = $props();
	let show = $state(true);
	export const hide = (): boolean => (show = false);
</script>

{#snippet waiting()}<p>loading</p>{/snippet}

{#if show}
	{#if boundary}
		<svelte:boundary>
			<Held {of} placeholder={waiting} />
			{#snippet failed(error)}<p data-failed>{(error as Error).message}</p>{/snippet}
		</svelte:boundary>
	{:else}
		<Held {of} placeholder={waiting} />
	{/if}
{/if}
