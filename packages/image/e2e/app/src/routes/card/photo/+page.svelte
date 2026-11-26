<script lang="ts">
	import { page } from '$app/state';

	let { data } = $props();
</script>

<svelte:head>
	<meta property="og:image" content={new URL(data.share.src, page.url).href} />
</svelte:head>

<h1>a page with a share card that draws images</h1>
