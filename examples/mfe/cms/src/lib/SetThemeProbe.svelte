<script lang="ts">
	import { getTheme } from './theme.ts';
	const theme = getTheme();
	let clicks = $state(0);
</script>

<button data-testid="set-theme-probe" onclick={() => clicks++}>{theme}: {clicks}</button>
