<script lang="ts">
	import { page } from '$app/state';
	import { getImage } from '@ogygia/image';

	let { data } = $props();
	const src = $derived(
		page.url.searchParams.get('format') === 'webp'
			? getImage(data.share, { formats: ['webp'] }).src
			: data.share.src
	);
</script>

<svelte:head>
	<meta property="og:image" content={new URL(src, page.url).href} />
</svelte:head>

<h1>a share card rendered on request</h1>
