<script lang="ts">
	import Region from '../../../src/Region.svelte';
	import LakeIslandHost from './LakeIslandHost.svelte';
</script>

<Region
	__og={{
		mode: 'island',
		entry: '/test/browser/fixtures/LakeIslandHost.svelte',
		component: LakeIslandHost,
		wake: 'interaction'
	}}
	__props={{}}
/>
