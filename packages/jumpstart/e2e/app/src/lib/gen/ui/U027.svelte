<script>
	import I032 from '../icons/I032.svelte';
	import { u005 } from '../util/u005.js';

	let { item } = $props();
</script>

<div class="ui-27">
	<I032 label="i32" />
	<strong>{item.title}</strong>
	<small>{u005(item.n)}</small>
</div>
