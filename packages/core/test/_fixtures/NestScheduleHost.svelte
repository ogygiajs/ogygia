<script lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
	let { idle = false }: { idle?: boolean } = $props();
</script>

<div data-host>
	<Region
		__og={{
			mode: 'island',
			entry: '/islands/tiny.js',
			component: Tiny,
			wake: idle ? 'idle' : 'load'
		}}
		__props={{}}
	/>
</div>
