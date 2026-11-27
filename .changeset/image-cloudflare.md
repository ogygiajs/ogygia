---
'@ogygia/image': minor
---

`cloudflare({ links?, binding? })` from `@ogygia/image/vite` is an encoder for Cloudflare Workers: a page the Worker renders on request names each file as an Image Transformations link (`/cdn-cgi/image/<options>/<original>`), or with `links: false` its image endpoint makes each file with the Worker's Images binding (default `IMAGES`) and keeps it in `caches.default`; a Worker without that binding answers 500 and says `image_binding_missing`. `cloudflare()` on any adapter but adapter-cloudflare (adapter-auto included) fails the server build with `image_option_invalid`. Prerendered pages still name the files the build makes.
A page rendered on request, or in dev, that asks the encoder for a crop or operation it cannot make (Cloudflare: an `entropy` position, a turn other than a quarter, `normalize`, `negate`, `gamma`, `tint`, `modulate` hue or lightness, an AVIF source; a link also cannot make a PNG from another format) fails to render with `image_encoder_cannot`, naming the encoder and the need.
A build for an adapter whose runtime cannot load sharp, with `sharp()` as the encoder, now says `image_no_encoder` once, naming `cloudflare()`, instead of `image_adapter_no_encoder` (removed) once per build pass.
The image endpoint's reader checks an original with Web Crypto, so a Worker's image endpoint needs no Node crypto.
