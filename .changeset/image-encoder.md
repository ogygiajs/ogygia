---
'@ogygia/image': minor
---

`image({ encoder })` says who makes the image files: `sharp()` from `@ogygia/image/vite` (the default, as before: the app's own endpoint makes every live file and the build every prerendered one), or a list in order of priority (one platform, at most one encoder that makes files at the app's endpoint, `sharp()` only last); anything else fails the build with `image_option_invalid`. A Node server bundle now loads the files it reads and notes on disk only in dev and in the build.
`getImage()`'s `sources` rows may carry `media`, `sizes`, `width` and `height` beside `type` and `srcset`, and `<Img>` writes them on each `<source>` when present (`type` is now optional); today's rows are unchanged.
