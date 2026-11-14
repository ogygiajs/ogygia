<script>
	import I006 from '../icons/I006.svelte';
	import { u007 } from '../util/u007.js';

	let { item } = $props();
</script>

<div class="ui-26">
	<I006 label="i6" />
	<strong>{item.title}</strong>
	<small>{u007(item.n)}</small>
</div>
