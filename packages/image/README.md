# @ogygia/image

Responsive images for [ogygia](https://ogygiajs.dev) apps. The build reads each image once (its size and a tiny blur placeholder) and encodes nothing. Pages ask for the files they need, by preset or by layout, and the image endpoint makes each one the first time it is asked for: in dev, in a prerender (saved as a static file beside the page), or on a live server.

```sh
pnpm add @ogygia/image sharp
```

sharp, the encoder, is a peer: list it in your app's `dependencies` (a server build fails with `image_sharp_missing` without it). `image({ encoder: sharp() })` (from `@ogygia/image/vite`) is the default; on Cloudflare Workers use `image({ encoder: cloudflare() })` (Image Transformations links, or the Worker's Images binding with `links: false`); on Vercel `image({ encoder: [vercel(), sharp()] })` with `adapter({ images: vercel().images })` (Vercel's Image Optimization links for plain resizes, sharp for crops and operations).

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { image } from '@ogygia/image/vite';

export default defineConfig({
	plugins: [
		ogygia(),
		image({
			presets: {
				cover: { layout: 'fullWidth', aspect: '16/9', priority: true },
				thumb: { width: 400, aspect: '1/1' }
			}
		}),
		sveltekit()
	]
});
```

```ts
// src/app.d.ts
/// <reference types="ogygia/types" />
/// <reference types="@ogygia/image/types" />
```

```svelte
<script lang="ts">
	import { Img } from '@ogygia/image';
	const hero = import.meta.og.image('../lib/images/hero.jpg');
</script>

<Img of={hero} preset="cover" alt="The harbor at dusk" />
<Img of={hero} preset="thumb" alt="" />
```

On a live server each file is a signed URL under `/__ogygia__/i/`: a tampered one is refused. A prerendered page's files are made by the build as static files under `_app/immutable/og/`, named by their recipe, so their URLs stay the same across builds with no secret. A page rendered on a live server can have its files made at build too: `import.meta.og.image('./hero.jpg', { warm: 'cover' })` writes the `cover` preset's files there. Crops are real files, animated GIFs become animated WebP (with a first-frame still for visitors who ask for less motion), SVGs are served as they are, an image can carry a dark file (`{ dark: './x-dark.png' }`, following the system or, with `image({ theme })`, the app's theme switch) and art-directed crops or files by media condition (a preset's `art`, `<Img art>`), and `<Img>` renders server HTML with no client script and no inline event handler. With `@ogygia/content`, markdown images and `./` frontmatter covers work the same way. Images live under `src/`. See the [docs](https://ogygiajs.dev/docs/content/images).
