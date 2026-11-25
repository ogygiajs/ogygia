---
'@ogygia/image': minor
---

A moving image (an animated GIF or WebP) offers its first frame as a still to visitors who ask for less motion (`<source media="(prefers-reduced-motion: reduce)">`, files named with `-s`; Cloudflare makes it with `anim=false`); with `vercel()` alone, which cannot keep one frame, no still is offered and the build warns `image_still_left_out`.
`import.meta.og.image(src, { dark: './x-dark.png' })` gives an image a dark file of the same shape (another shape fails with `image_option_invalid`), shown at `(prefers-color-scheme: dark)`; `image({ theme: { dark, light } })` makes it follow an app's own theme selectors instead, as two `<picture>`s a static stylesheet picks between, the hidden one never downloaded.
Art direction: a preset's `art: [{ media, aspect?, position?, width? }]`, `<Img art>` and `getImage(of, { art })` (another crop, or another source with `of`), and the macro's `art: { '<media>': './x.jpg' }`; each twin row carries its own `width` and `height`, so nothing shifts when the media changes. `warm` warms twins too.
`getImage()`'s result names one preload per candidate set, `preloads` (each with its `media` when the image has twins), in place of `preload`.
