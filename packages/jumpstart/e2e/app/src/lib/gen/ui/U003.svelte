<script>
	import I015 from '../icons/I015.svelte';
	import I031 from '../icons/I031.svelte';
	import I041 from '../icons/I041.svelte';
	import { u000 } from '../util/u000.js';

	let { item } = $props();
</script>

<div class="ui-3">
	<I015 label="i15" />
	<I031 label="i31" />
	<I041 label="i41" />
	<strong>{item.title}</strong>
	<small>{u000(item.n)}</small>
</div>
