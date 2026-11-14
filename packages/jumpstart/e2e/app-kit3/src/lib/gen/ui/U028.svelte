<script>
	import I034 from '../icons/I034.svelte';
	import I044 from '../icons/I044.svelte';
	import I049 from '../icons/I049.svelte';
	import { u009 } from '../util/u009.js';

	let { item } = $props();
</script>

<div class="ui-28">
	<I034 label="i34" />
	<I044 label="i44" />
	<I049 label="i49" />
	<strong>{item.title}</strong>
	<small>{u009(item.n)}</small>
</div>
