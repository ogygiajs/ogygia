<script lang="ts">
	// No prop — the counter comes from the nearest <Provide> above, across the island boundary.
	import { readRoom } from '$lib/room-context.svelte.js';

	const counter = readRoom();
</script>

<div data-ctx-writer data-is-instance={counter ? 'true' : 'false'}>
	<button type="button" onclick={() => counter?.inc()}>inc</button>
</div>
