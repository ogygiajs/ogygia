<script lang="ts">
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
</script>

<div data-host>
	<Region __mode="island" __entry="/islands/inner.js" __component={Tiny} __props={{ inner: 1 }} />
</div>
