<script>
	import I042 from '../icons/I042.svelte';
	import I056 from '../icons/I056.svelte';
	import { u006 } from '../util/u006.js';

	let { item } = $props();
</script>

<div class="ui-18">
	<I042 label="i42" />
	<I056 label="i56" />
	<strong>{item.title}</strong>
	<small>{u006(item.n)}</small>
</div>
