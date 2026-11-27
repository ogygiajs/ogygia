<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { Img } from '@ogygia/image';

	let { children }: { children: Snippet } = $props();
	const mark = import.meta.og.image('../lib/images/avatar.jpg');
</script>

<svelte:head>
	<link rel="alternate" type="application/rss+xml" title="A blog" href={resolve('/feed.xml')} />
</svelte:head>

<header><Img of={mark} preset="avatar" alt="The site's mark" id="site-mark" /></header>
{@render children()}
