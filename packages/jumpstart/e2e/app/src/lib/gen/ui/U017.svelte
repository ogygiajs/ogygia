<script>
	import I037 from '../icons/I037.svelte';
	import I039 from '../icons/I039.svelte';
	import { u000 } from '../util/u000.js';

	let { item } = $props();
</script>

<div class="ui-17">
	<I037 label="i37" />
	<I039 label="i39" />
	<strong>{item.title}</strong>
	<small>{u000(item.n)}</small>
</div>
