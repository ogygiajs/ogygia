<script>
	import I009 from '../icons/I009.svelte';
	import I016 from '../icons/I016.svelte';
	import I017 from '../icons/I017.svelte';
	import { u004 } from '../util/u004.js';

	let { item } = $props();
</script>

<div class="ui-10">
	<I009 label="i9" />
	<I016 label="i16" />
	<I017 label="i17" />
	<strong>{item.title}</strong>
	<small>{u004(item.n)}</small>
</div>
