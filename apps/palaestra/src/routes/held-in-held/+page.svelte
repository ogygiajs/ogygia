<script lang="ts">
	// A held region inside a held region's island (e2e/held-in-held.spec.ts, #945).
	import OuterHost from '$lib/heldinheld/OuterHost.svelte' with { wake: 'load' };
</script>

<main>
	<h1>held in held</h1>
	<OuterHost />
</main>
