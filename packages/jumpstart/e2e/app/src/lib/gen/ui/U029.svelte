<script>
	import I036 from '../icons/I036.svelte';
	import I045 from '../icons/I045.svelte';
	import { u007 } from '../util/u007.js';

	let { item } = $props();
</script>

<div class="ui-29">
	<I036 label="i36" />
	<I045 label="i45" />
	<strong>{item.title}</strong>
	<small>{u007(item.n)}</small>
</div>
