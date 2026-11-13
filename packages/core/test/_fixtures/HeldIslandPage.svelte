<script>
	// A page that places a region it awaited in its own render (`<Region of={await region(...)}>`):
	// the held-region-runtime suite hands it the awaited value.
	import Region from '../../src/Region.svelte';

	let { held } = $props();
</script>

<main data-page>
	<Region of={held} />
</main>
