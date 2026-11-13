<script lang="ts">
	// An island that hands the test what its context holds under `probe` as it starts.
	import { getContext } from 'svelte';
	(globalThis as { __og_probe_context?: unknown }).__og_probe_context = getContext('probe');
</script>

<p data-testid="context-probe">probe</p>
