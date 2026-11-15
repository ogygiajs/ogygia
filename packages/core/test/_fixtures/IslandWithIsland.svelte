<script lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
</script>

<div data-host>
	<Region
		__og={{ mode: 'island', entry: '/islands/inner.js', component: Tiny }}
		__props={{ inner: 1 }}
	/>
</div>
