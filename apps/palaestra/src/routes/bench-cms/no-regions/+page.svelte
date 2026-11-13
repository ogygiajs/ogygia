<script lang="ts">
	import CmsShell from '$lib/bench/CmsShell.svelte';
	let { data } = $props();
</script>

<svelte:head><title>bench: CMS shape (no regions)</title></svelte:head>

<CmsShell page={data} />
