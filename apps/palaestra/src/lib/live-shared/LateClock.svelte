<script lang="ts">
	// Mounted by Holder after a click, long after Holder hydrated: it reads the clock's entry that
	// Leaver made (e2e/live-query-late-reader.spec.ts).
	import { clock } from '$lib/greetings.remote';
	const c = clock();
</script>

<div data-late-clock>late reader: {c.current}</div>
