<script lang="ts">
	// A KEPT island that reads the live clock only from a child it mounts later
	// (e2e/live-query-late-reader.spec.ts).
	import LateClock from './LateClock.svelte';
	let show = $state(false);
</script>

<div data-holder>
	<button data-show-clock onclick={() => (show = true)}>show clock</button>
	{#if show}<LateClock />{/if}
</div>
