---
'@ogygia/image': minor
---

`vercel({ sizes?, qualities? })` from `@ogygia/image/vite` is an encoder for adapter-vercel: a page rendered on request names each file as a Vercel Image Optimization link (`/_vercel/image?url=…&w=…&q=…`), its width snapped up to `sizes`, AVIF or WebP picked by Vercel from the browser's `Accept`; hand `encoder.images` to the adapter (`adapter({ images })`). Prerendered pages still name the files the build makes.
`image({ encoder: [vercel(), sharp()] })`: a list is in order of priority, the first encoder that can make a file making it, so the crops, positions, operations, named PNG or JPEG, and GIF, TIFF or animated sources Vercel cannot make go to the app's own sharp endpoint; with `vercel()` alone they fail to render with `image_encoder_cannot`.
A build that lists `vercel()` fails with `image_vercel_config` when adapter-vercel's `.vercel/output/config.json` `images` lacks a width, quality or format the app names, or the host of a full-URL `paths.assets`, or when it opens more than the app needs (no `qualities`, or `localPatterns` unset or wider than the app's originals), or when the adapter is not adapter-vercel. `vercel()`'s `images` lists qualities 60 and 80 by default and `localPatterns` for `/_app/immutable/assets/` only, and a plugin or preset `quality` it does not list fails the build with `image_option_invalid`.
