// `@ogygia/image/types` — `import.meta.og.image` (merged into core's `ImportMetaOg` from
// `ogygia/types`). Reference both from the app's `src/app.d.ts`:
//
//   /// <reference types="ogygia/types" />
//   /// <reference types="@ogygia/image/types" />
//
// A compile construct: the `image()` plugin rewrites each call at transform time.
interface ImportMetaOg {
	/**
	 * Read an image file at build and get its source descriptor, for `<Img of={…}>` from
	 * `@ogygia/image`. The path is relative to this file, like an import, and the file sits under
	 * `src/`; the options are literals and belong to the source (quality, placeholder, ops). Only the
	 * size and a blur placeholder are made at build: each file a page shows is made on first request.
	 * Needs `image()` from `@ogygia/image/vite` beside `ogygia()`.
	 *
	 *   const hero = import.meta.og.image('./hero.jpg', { quality: 70 });
	 */
	image: {
		(
			src: string,
			options?: import('@ogygia/image/vite').ImageOptions
		): import('@ogygia/image').ImageDescriptor;
		/**
		 * Every image a glob matches, keyed by path: `import.meta.og.image.glob('./gallery/*.jpg')`.
		 * A pattern that matches nothing fails the build.
		 */
		glob(
			pattern: string,
			options?: import('@ogygia/image/vite').ImageOptions
		): Record<string, import('@ogygia/image').ImageDescriptor>;
		/**
		 * A share card: a Svelte component drawn as a PNG (satori and resvg, which the app installs),
		 * as a function of its props that returns its descriptor. The path is relative to this file;
		 * `fonts` are `.woff`, `.ttf` or `.otf` files (paths relative to this file, or a package's
		 * files), and the card's CSS names their families. Call it on the server (a load, a page's
		 * server render): its props are JSON, at most 2048 characters in a URL.
		 *
		 *   export const ShareCard = import.meta.og.image.card('./ShareCard.svelte', { width: 1200, height: 630, fonts: ['./serif.woff'] });
		 *   return { share: ShareCard({ title: post.title }) };
		 */
		card<Props extends Record<string, unknown> = Record<string, unknown>>(
			component: string,
			options: { width: number; height: number; fonts: string[] }
		): (props: Props) => import('@ogygia/image').ImageDescriptor;
	};
}
