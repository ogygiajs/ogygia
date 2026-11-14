<script>
	import I004 from '../icons/I004.svelte';
	import I035 from '../icons/I035.svelte';
	import { u008 } from '../util/u008.js';

	let { item } = $props();
</script>

<div class="ui-8">
	<I004 label="i4" />
	<I035 label="i35" />
	<strong>{item.title}</strong>
	<small>{u008(item.n)}</small>
</div>
