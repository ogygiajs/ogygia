<script lang="ts">
	import Sidebar from '../../../src/site/components/Sidebar.svelte';
	import type { NavTree } from '../../../src/site/types.ts';

	let { nav, first }: { nav: NavTree; first: string } = $props();
	// svelte-ignore state_referenced_locally
	let base = $state(first);
	export const move = (next: string): void => {
		base = next;
	};
</script>

<Sidebar {nav} {base} />
