<script lang="ts">
	// A server island inside a server island inside an island (e2e/hole-in-lake.spec.ts, #948).
	import Outer from '$lib/holeinlake/Outer.svelte' with { wake: 'interaction' };
</script>

<main>
	<h1>hole in lake</h1>
	<Outer />
</main>
