<script>
	import I007 from '../icons/I007.svelte';
	import I048 from '../icons/I048.svelte';
	import { u006 } from '../util/u006.js';

	let { item } = $props();
</script>

<div class="ui-16">
	<I007 label="i7" />
	<I048 label="i48" />
	<strong>{item.title}</strong>
	<small>{u006(item.n)}</small>
</div>
