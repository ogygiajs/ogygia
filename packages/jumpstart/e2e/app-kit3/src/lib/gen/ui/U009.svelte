<script>
	import I004 from '../icons/I004.svelte';
	import I022 from '../icons/I022.svelte';
	import I034 from '../icons/I034.svelte';
	import { u000 } from '../util/u000.js';

	let { item } = $props();
</script>

<div class="ui-9">
	<I004 label="i4" />
	<I022 label="i22" />
	<I034 label="i34" />
	<strong>{item.title}</strong>
	<small>{u000(item.n)}</small>
</div>
