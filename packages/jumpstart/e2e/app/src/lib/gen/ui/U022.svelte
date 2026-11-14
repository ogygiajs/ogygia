<script>
	import I002 from '../icons/I002.svelte';
	import I010 from '../icons/I010.svelte';
	import { u008 } from '../util/u008.js';

	let { item } = $props();
</script>

<div class="ui-22">
	<I002 label="i2" />
	<I010 label="i10" />
	<strong>{item.title}</strong>
	<small>{u008(item.n)}</small>
</div>
