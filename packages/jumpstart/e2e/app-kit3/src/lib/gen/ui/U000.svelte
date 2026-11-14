<script>
	import I002 from '../icons/I002.svelte';
	import I010 from '../icons/I010.svelte';
	import I043 from '../icons/I043.svelte';
	import { u010 } from '../util/u010.js';

	let { item } = $props();
</script>

<div class="ui-0">
	<I002 label="i2" />
	<I010 label="i10" />
	<I043 label="i43" />
	<strong>{item.title}</strong>
	<small>{u010(item.n)}</small>
</div>
