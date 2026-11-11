<script lang="ts">
	// Reads the live clock as it hydrates: it makes the clock's entry (e2e/live-query-late-reader.spec.ts).
	import { clock } from '$lib/greetings.remote';
	const c = clock();
</script>

<div data-leaver>leaver: {c.current}</div>
