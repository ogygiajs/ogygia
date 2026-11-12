<script lang="ts">
	// A widget root holding a server island (`render: 'deferred'`): the page that shows the widget
	// shows the fallback, then the island's server render.
	import Later from './Later.svelte' with { render: 'deferred' };
	let { who = 'stranger' }: { who?: string } = $props();
</script>

<section data-testid="dash-holder">
	<Later {who}>
		{#snippet ogygiaFallback()}<p data-testid="dash-later-fallback">loading…</p>{/snippet}
	</Later>
</section>
