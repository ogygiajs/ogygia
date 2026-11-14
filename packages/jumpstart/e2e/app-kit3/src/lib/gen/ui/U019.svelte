<script>
	import I003 from '../icons/I003.svelte';
	import I018 from '../icons/I018.svelte';
	import I058 from '../icons/I058.svelte';
	import { u009 } from '../util/u009.js';

	let { item } = $props();
</script>

<div class="ui-19">
	<I003 label="i3" />
	<I018 label="i18" />
	<I058 label="i58" />
	<strong>{item.title}</strong>
	<small>{u009(item.n)}</small>
</div>
