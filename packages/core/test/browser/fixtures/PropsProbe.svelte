<script lang="ts">
	// An island that hands the props it was given to the test, as the island's own code sees them.
	let props: Record<string, unknown> = $props();
	(globalThis as { __og_probe_props?: Record<string, unknown> }).__og_probe_props = props;
</script>

<p data-testid="props-probe">probe</p>
