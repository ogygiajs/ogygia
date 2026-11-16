<script lang="ts">
	import { untrack } from 'svelte';

	let { run }: { run: () => void } = $props();
	untrack(() => run());
</script>
