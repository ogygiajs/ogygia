<script>
	import I032 from '../icons/I032.svelte';
	import { u011 } from '../util/u011.js';

	let { item } = $props();
</script>

<div class="ui-24">
	<I032 label="i32" />
	<strong>{item.title}</strong>
	<small>{u011(item.n)}</small>
</div>
