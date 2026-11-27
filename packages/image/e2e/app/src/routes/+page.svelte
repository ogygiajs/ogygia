<script lang="ts">
	import { resolve } from '$app/paths';
	import { Img, getImage } from '@ogygia/image';
	import Counter from '$lib/islands/Counter.svelte' with { wake: 'load' };

	const hero = import.meta.og.image('../lib/images/hero.jpg');
	const portrait = import.meta.og.image('../lib/images/portrait.jpg');
	const avatar = import.meta.og.image('../lib/images/avatar.jpg');
	const gallery = import.meta.og.image.glob('../lib/images/gallery/*.jpg');
	const logo = import.meta.og.image('../lib/images/logo.svg');
	const spinner = import.meta.og.image('../lib/images/spinner.gif');
	const badge = import.meta.og.image('../lib/images/badge.png');
	const first_cover = import.meta.og.image('../content/blog/first-post/cover.jpg');
	const warmed = import.meta.og.image('../lib/images/portrait.jpg', { warm: 'thumb' });
	const backdrop = getImage(hero, { layout: 'fixed', width: 120, height: 60 });
</script>

<h1>images</h1>
<nav>
	<a href={resolve('/blog/[slug]', { slug: 'first-post' })} id="to-post">The first post</a>
	<a href={resolve('/blog/[slug]', { slug: 'second-post' })}>The second post</a>
	<a href={resolve('/blog/[slug]', { slug: 'third-post' })}>The third post</a>
	<a href={resolve('/island')}>An island's priority image</a>
</nav>
<Counter />
<Img of={hero} preset="cover" alt="Hills at dusk" id="hero" />
<p><Img of={avatar} preset="avatar" alt="An avatar" id="avatar" /></p>
<p><Img of={hero} preset="thumb" alt="Hills, as a thumbnail" id="thumb" /></p>
<p><Img of={first_cover} preset="thumb" morph alt="The first post" id="post-thumb" /></p>
<p><Img of={warmed} preset="thumb" alt="A tall picture, warmed" id="warmed" /></p>
<div id="backdrop" style="background-image:url({backdrop.src});width:120px;height:60px"></div>
<div class="spacer"></div>
<Img of={portrait} width={400} alt="A tall picture" id="portrait" title="Tall" />
<Img of={hero} width={400} height={400} alt="Hills, cropped square" id="crop" />
<Img of={badge} width={160} alt="A round badge" id="badge" />
<Img of={logo} alt="A logo" id="logo" />
<Img of={spinner} alt="A moving dot" id="spinner" />
<ul>
	{#each Object.entries(gallery) as [key, img] (key)}
		<li><Img of={img} width={300} alt={key} class="gallery" /></li>
	{/each}
</ul>
