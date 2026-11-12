<script lang="ts">
	// A held region's component that wakes, with a server island (`render: 'deferred'`, the wrapper the
	// transform emits) inside it: held-hole.test.ts bakes it as a remote's answer does, then wakes it.
	import Region from '../../../src/Region.svelte';
	import Label from './Label.svelte';
</script>

{#snippet fallback()}<p data-hole-fallback>loading</p>{/snippet}

<div data-held-card>
	<Region
		__mode="server"
		__entry="held-hole-greeting"
		__component={Label}
		__props={{ text: 'held greeting' }}
		__defer="load"
		ogygiaFallback={fallback}
	/>
</div>
