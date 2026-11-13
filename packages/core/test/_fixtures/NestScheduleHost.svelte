<script lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
	let { idle = false }: { idle?: boolean } = $props();
</script>

<div data-host>
	<Region __mode="island" __entry="/islands/tiny.js" __component={Tiny} __props={{}} {idle} />
</div>
