<script>
	import I005 from '../icons/I005.svelte';
	import { u001 } from '../util/u001.js';

	let { item } = $props();
</script>

<div class="ui-2">
	<I005 label="i5" />
	<strong>{item.title}</strong>
	<small>{u001(item.n)}</small>
</div>
