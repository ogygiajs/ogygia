<script>
	import I029 from '../icons/I029.svelte';
	import I034 from '../icons/I034.svelte';
	import I042 from '../icons/I042.svelte';
	import { u002 } from '../util/u002.js';

	let { item } = $props();
</script>

<div class="ui-7">
	<I029 label="i29" />
	<I034 label="i34" />
	<I042 label="i42" />
	<strong>{item.title}</strong>
	<small>{u002(item.n)}</small>
</div>
