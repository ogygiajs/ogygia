<script lang="ts">
	// An island that shows a prop as it is NOW: a pushed prop (a live tick, a kept island's next
	// page) shows in place, on the node the server rendered.
	let { text = '' }: { text?: string } = $props();
</script>

<p data-testid="label">{text}</p>
