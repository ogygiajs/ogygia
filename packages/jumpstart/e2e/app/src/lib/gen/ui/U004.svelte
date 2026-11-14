<script>
	import I025 from '../icons/I025.svelte';
	import I046 from '../icons/I046.svelte';
	import { u001 } from '../util/u001.js';

	let { item } = $props();
</script>

<div class="ui-4">
	<I025 label="i25" />
	<I046 label="i46" />
	<strong>{item.title}</strong>
	<small>{u001(item.n)}</small>
</div>
