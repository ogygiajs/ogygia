<script lang="ts">
	// The page around NestHost: it is placed as an island that wakes on interaction, so a test can
	// edit it while it sleeps.
	import Region from '../../../src/Region.svelte';
	import NestHost from './NestHost.svelte';
</script>

<Region
	__mode="island"
	__entry="/test/browser/fixtures/NestHost.svelte"
	__component={NestHost}
	__props={{}}
	interaction={true}
/>
