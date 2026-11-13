<script lang="ts">
	// A server island's component that wakes (`render: 'deferred', fetch: 'load'`), with another server
	// island inside it: woken-hole-nested.test.ts answers its hole with the endpoint's render of it.
	import Region from '../../../src/Region.svelte';
	import Label from './Label.svelte';
</script>

{#snippet fallback()}<p data-inner-fallback>loading</p>{/snippet}

<div data-woken-card>
	<Region
		__mode="server"
		__entry="woken-hole-inner"
		__component={Label}
		__props={{ text: 'inner greeting' }}
		__defer="load"
		ogygiaFallback={fallback}
	/>
</div>
