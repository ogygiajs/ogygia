---
'@ogygia/image': minor
---

`sharp({ effort: { avif } })` sets how hard sharp works on AVIF files, a whole number from 0 to 9 (default 2): a higher one makes smaller files and slower builds. Anything else fails the build with `image_option_invalid`.
