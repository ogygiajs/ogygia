<script lang="ts">
	// An island whose <svelte:head> holds a tag the server and the client write alike (a style's text
	// is not: the formatter splits it, and the client trims it), so the page's copy is the island's
	// and is retired. Its place among the other islands' head tags is what the test reads.
	let { name = '' }: { name?: string } = $props();
</script>

<svelte:head>
	<meta name="head-style" content={name} />
</svelte:head>

<p data-testid="head-style">{name}</p>
