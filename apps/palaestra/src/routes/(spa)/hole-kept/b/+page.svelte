<script lang="ts">
	// The page a navigation from /hole-kept/a lands on: the same hole and island, same props
	// (e2e/hole-kept-sheet.spec.ts, e2e/kept-heading-focus.spec.ts).
	import KeptHole from '$lib/KeptHole.svelte' with { render: 'deferred' };
	import KeptHeading from '$lib/KeptHeading.svelte' with { wake: 'load' };
</script>

<h1 data-hole-kept-page="b">hole kept: b</h1>
<a href="./a" data-hole-kept-link data-ogygia-speculate="off">to a</a>
<KeptHole>
	{#snippet ogygiaFallback()}<p data-kept-hole-fallback>loading…</p>{/snippet}
</KeptHole>
<KeptHeading />
