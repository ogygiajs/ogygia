<script>
	import I000 from '../icons/I000.svelte';
	import I012 from '../icons/I012.svelte';
	import I028 from '../icons/I028.svelte';
	import { u007 } from '../util/u007.js';

	let { item } = $props();
</script>

<div class="ui-23">
	<I000 label="i0" />
	<I012 label="i12" />
	<I028 label="i28" />
	<strong>{item.title}</strong>
	<small>{u007(item.n)}</small>
</div>
