<script>
	import I038 from '../icons/I038.svelte';
	import I041 from '../icons/I041.svelte';
	import I042 from '../icons/I042.svelte';
	import { u003 } from '../util/u003.js';

	let { item } = $props();
</script>

<div class="ui-12">
	<I038 label="i38" />
	<I041 label="i41" />
	<I042 label="i42" />
	<strong>{item.title}</strong>
	<small>{u003(item.n)}</small>
</div>
