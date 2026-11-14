<script lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
</script>

<div data-host>
	<Region __mode="server" __entry="hole-in-island" __component={Tiny} __props={{}} __defer="load">
		{#snippet ogygiaFallback()}<p data-fallback>wait</p>{/snippet}
	</Region>
</div>
