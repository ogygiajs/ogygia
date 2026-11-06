<script lang="ts">
	import CssProbeShared from '$lib/CssProbeShared.svelte';
	let { children } = $props();
</script>

<CssProbeShared />
{@render children()}
