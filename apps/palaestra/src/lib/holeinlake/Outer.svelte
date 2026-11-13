<script lang="ts">
	// an island, woken only by a press, that renders a server island
	import Middle from './Middle.svelte' with { render: 'deferred', fetch: 'idle' };
	let count = $state(0);
</script>

<article data-hil-outer>
	<button onclick={() => (count += 1)}>pressed {count}</button>
	<Middle />
</article>
