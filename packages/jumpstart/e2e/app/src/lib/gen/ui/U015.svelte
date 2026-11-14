<script>
	import I014 from '../icons/I014.svelte';
	import I031 from '../icons/I031.svelte';
	import I044 from '../icons/I044.svelte';
	import { u005 } from '../util/u005.js';

	let { item } = $props();
</script>

<div class="ui-15">
	<I014 label="i14" />
	<I031 label="i31" />
	<I044 label="i44" />
	<strong>{item.title}</strong>
	<small>{u005(item.n)}</small>
</div>
