<script lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
</script>

<div data-host>
	<Region
		__og={{ mode: 'server', entry: 'hole-in-island', component: Tiny, when: 'load' }}
		__props={{}}
	>
		{#snippet ogygiaFallback()}<p data-fallback>wait</p>{/snippet}
	</Region>
</div>
