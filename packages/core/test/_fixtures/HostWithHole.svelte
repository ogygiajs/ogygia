<script lang="ts">
	// An island whose body places a server island — the nested rule renders that hole INLINE.
	import Region from '../../src/Region.svelte';
	import KeepHole from './KeepHole.svelte';
</script>

<div data-host>
	<Region
		__og={{ mode: 'server', entry: 'hole-keep', component: KeepHole, when: 'load' }}
		__props={{}}
	>
		{#snippet ogygiaFallback()}<p data-fallback>anonymous</p>{/snippet}
	</Region>
</div>
