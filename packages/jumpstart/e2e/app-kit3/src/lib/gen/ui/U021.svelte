<script>
	import I032 from '../icons/I032.svelte';
	import I056 from '../icons/I056.svelte';
	import I059 from '../icons/I059.svelte';
	import { u001 } from '../util/u001.js';

	let { item } = $props();
</script>

<div class="ui-21">
	<I032 label="i32" />
	<I056 label="i56" />
	<I059 label="i59" />
	<strong>{item.title}</strong>
	<small>{u001(item.n)}</small>
</div>
