<script lang="ts">
	// COPIES OF ONE ISLAND (e2e/delta-copy-count.spec.ts): /delta-copies/<n> shows n identical copies
	// (same component, same props, one fingerprint). Navigating from 1 to 2, the browser holds one live
	// copy: the server reuses that one and renders the second.
	import Tally from '$lib/props-tail/Tally.svelte' with { wake: 'load' };
	let { data } = $props();
</script>

<h1 data-static-shell>{data.copies} copies</h1>
<p>
	<a href="/delta-copies/1" data-to-1>one copy</a>
	<a href="/delta-copies/2" data-to-2>two copies</a>
</p>

{#each { length: data.copies } as _}
	<Tally label="twin" start={10} />
{/each}
