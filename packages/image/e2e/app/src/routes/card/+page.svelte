<script lang="ts">
	import { page } from '$app/state';
	import { Img } from '@ogygia/image';

	let { data } = $props();
</script>

<svelte:head>
	<meta property="og:image" content={new URL(data.share.src, page.url).href} />
</svelte:head>

<h1>a page with a share card</h1>
<Img of={data.share} preset="thumb" alt="" id="card" />
