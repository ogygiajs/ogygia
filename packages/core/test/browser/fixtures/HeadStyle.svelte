<script lang="ts">
	// An island whose <svelte:head> holds a meta (the server and the client write it alike) and a
	// style written over several lines (they do not: the client trims the style's text). The page's
	// copy of each is the island's and is retired; their place among the other islands' head tags
	// is what the tests read.
	let { name = '' }: { name?: string } = $props();
</script>

<svelte:head>
	<meta name="head-style" content={name} />
	<style data-head-style={name}>
		p[data-testid='head-style'] {
			margin: 0;
		}
	</style>
</svelte:head>

<p data-testid="head-style">{name}</p>
