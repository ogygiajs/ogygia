<script lang="ts">
	// A server island inside a dash widget: rendered by dash's server when the browser asks.
	let { who = 'stranger' }: { who?: string } = $props();
</script>

<p data-testid="dash-later">later, {who}</p>
