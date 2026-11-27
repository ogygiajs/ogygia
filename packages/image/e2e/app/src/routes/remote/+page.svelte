<script lang="ts">
	import { resolve } from '$app/paths';
	import { Img } from '@ogygia/image';

	const field = import.meta.og.image('http://127.0.0.1:4176/photos/field.jpg', { warm: 'thumb' });
	const moved = import.meta.og.image('http://127.0.0.1:4176/moved/field.jpg');
</script>

<h1>remote images</h1>
<Img of={field} width={300} alt="A field, fetched at build" id="remote" />
<Img of={field} preset="thumb" alt="A field, warmed" id="remote-thumb" />
<Img of={moved} width={300} alt="A field, behind a redirect" id="remote-moved" />
<a href={resolve('/blog/[slug]', { slug: 'fourth-post' })}>The fourth post</a>
