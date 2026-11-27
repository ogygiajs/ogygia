<script lang="ts">
	import { page } from '$app/state';
	import { Region } from 'ogygia';
	import { Img, getImage } from '@ogygia/image';
	let { data } = $props();
	const share = $derived(new URL(getImage(data.cover, { width: 1200 }).src, page.url).href);
</script>

<svelte:head>
	<meta property="og:image" content={share} />
</svelte:head>

<article>
	<Img of={data.cover} preset="cover" morph alt={data.title} id="cover" />
	<h1>{data.title}</h1>
	<Region of={data.body} />
</article>
