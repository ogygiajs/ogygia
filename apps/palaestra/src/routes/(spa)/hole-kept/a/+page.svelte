<script lang="ts">
	// A HOLE KEPT ACROSS A NAVIGATION (e2e/hole-kept-sheet.spec.ts): the same hole, with the same
	// props, on /hole-kept/a and /hole-kept/b. And an island kept the same way, whose heading the
	// navigation focuses (e2e/kept-heading-focus.spec.ts).
	import KeptHole from '$lib/KeptHole.svelte' with { render: 'deferred' };
	import KeptHeading from '$lib/KeptHeading.svelte' with { wake: 'load' };
</script>

<h1 data-hole-kept-page="a">hole kept: a</h1>
<a href="./b" data-hole-kept-link data-ogygia-speculate="off">to b</a>
<KeptHole>
	{#snippet ogygiaFallback()}<p data-kept-hole-fallback>loading…</p>{/snippet}
</KeptHole>
<KeptHeading />
