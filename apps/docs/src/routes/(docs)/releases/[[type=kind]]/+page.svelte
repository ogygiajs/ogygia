<script lang="ts">
	import Releases from '$lib/releases/Releases.svelte';

	let { data } = $props();
</script>

<Releases {...data} />
