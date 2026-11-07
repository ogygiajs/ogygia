<script lang="ts">
	// Label's markup, and a count of its own teardowns: a live region that switches to static must
	// dispose the island it hydrated, not leave it running under the static morph.
	let { text = '' }: { text?: string } = $props();
	$effect(() => () => {
		const g = globalThis as { __og_live_disposed?: number };
		g.__og_live_disposed = (g.__og_live_disposed ?? 0) + 1;
	});
</script>

<p data-testid="label">{text}</p>
