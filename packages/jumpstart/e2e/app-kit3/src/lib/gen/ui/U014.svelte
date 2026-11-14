<script>
	import I035 from '../icons/I035.svelte';
	import I040 from '../icons/I040.svelte';
	import { u005 } from '../util/u005.js';

	let { item } = $props();
</script>

<div class="ui-14">
	<I035 label="i35" />
	<I040 label="i40" />
	<strong>{item.title}</strong>
	<small>{u005(item.n)}</small>
</div>
