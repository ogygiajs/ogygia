<script>
	import I019 from '../icons/I019.svelte';
	import I039 from '../icons/I039.svelte';
	import { u002 } from '../util/u002.js';

	let { item } = $props();
</script>

<div class="ui-13">
	<I019 label="i19" />
	<I039 label="i39" />
	<strong>{item.title}</strong>
	<small>{u002(item.n)}</small>
</div>
