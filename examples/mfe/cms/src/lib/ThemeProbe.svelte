<script lang="ts">
	import { getContext } from 'svelte';
	const theme = getContext<string>('mfe-cms-theme');
	let clicks = $state(0);
</script>

<button data-testid="theme-probe" onclick={() => clicks++}>{theme}: {clicks}</button>
