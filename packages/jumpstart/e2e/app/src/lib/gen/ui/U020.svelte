<script>
	import I013 from '../icons/I013.svelte';
	import I029 from '../icons/I029.svelte';
	import { u002 } from '../util/u002.js';

	let { item } = $props();
</script>

<div class="ui-20">
	<I013 label="i13" />
	<I029 label="i29" />
	<strong>{item.title}</strong>
	<small>{u002(item.n)}</small>
</div>
