<script>
	import I050 from '../icons/I050.svelte';
	import { u007 } from '../util/u007.js';

	let { item } = $props();
</script>

<div class="ui-1">
	<I050 label="i50" />
	<strong>{item.title}</strong>
	<small>{u007(item.n)}</small>
</div>
