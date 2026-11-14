<script>
	import I033 from '../icons/I033.svelte';
	import { u008 } from '../util/u008.js';

	let { item } = $props();
</script>

<div class="ui-25">
	<I033 label="i33" />
	<strong>{item.title}</strong>
	<small>{u008(item.n)}</small>
</div>
