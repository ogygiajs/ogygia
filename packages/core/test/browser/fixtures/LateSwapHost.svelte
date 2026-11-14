<script lang="ts">
	import type { Component } from 'svelte';

	let {
		late: Late,
		first
	}: {
		late: Component<{ load: () => Promise<Component>; props: Record<string, unknown> }>;
		first: () => Promise<Component>;
	} = $props();
	// svelte-ignore state_referenced_locally
	let load = $state(first);
	export const swap = (next: () => Promise<Component>): void => {
		load = next;
	};
</script>

<Late {load} props={{ text: 'kept' }} />
