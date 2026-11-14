<script>
	import I010 from '../icons/I010.svelte';
	import I012 from '../icons/I012.svelte';
	import I014 from '../icons/I014.svelte';
	import { u010 } from '../util/u010.js';

	let { item } = $props();
</script>

<div class="ui-5">
	<I010 label="i10" />
	<I012 label="i12" />
	<I014 label="i14" />
	<strong>{item.title}</strong>
	<small>{u010(item.n)}</small>
</div>
