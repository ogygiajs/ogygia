<script>
	// A held region's component with an island inside: the held-region-runtime suite awaits it as a
	// region in a page's render, then places it.
	import Region from '../../src/Region.svelte';
	import Tiny from './Tiny.svelte';
</script>

<div data-block>
	<Region __mode="island" __entry="/islands/tiny.js" __component={Tiny} __props={{}} />
</div>
