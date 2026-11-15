<script lang="ts">
	// A server island's component that wakes (`render: 'deferred', fetch: 'load'`), with another server
	// island inside it: woken-hole-nested.test.ts answers its hole with the endpoint's render of it.
	import Region from '../../../src/Region.svelte';
	import Label from './Label.svelte';
</script>

{#snippet fallback()}<p data-inner-fallback>loading</p>{/snippet}

<div data-woken-card>
	<Region
		__og={{ mode: 'server', entry: 'woken-hole-inner', component: Label, when: 'load' }}
		__props={{ text: 'inner greeting' }}
		ogygiaFallback={fallback}
	/>
</div>
