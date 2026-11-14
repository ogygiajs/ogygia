<script>
	import I046 from '../icons/I046.svelte';
	import I049 from '../icons/I049.svelte';
	import I051 from '../icons/I051.svelte';
	import { u008 } from '../util/u008.js';

	let { item } = $props();
</script>

<div class="ui-11">
	<I046 label="i46" />
	<I049 label="i49" />
	<I051 label="i51" />
	<strong>{item.title}</strong>
	<small>{u008(item.n)}</small>
</div>
