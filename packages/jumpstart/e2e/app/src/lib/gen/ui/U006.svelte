<script>
	import I002 from '../icons/I002.svelte';
	import { u011 } from '../util/u011.js';

	let { item } = $props();
</script>

<div class="ui-6">
	<I002 label="i2" />
	<strong>{item.title}</strong>
	<small>{u011(item.n)}</small>
</div>
