---
'@ogygia/compiler': minor
---

The retired `ogygia()` option keys (`regions`, `regionTtl`, `continuity`, `preload`, `plugins`, `freeze`, `content`, `devtools`, `profiler`) no longer have their own messages: any key `ogygia()` does not have, a misspelling included, now fails the build as `option_unknown` and lists the keys it has. Move a retired key to its replacement (`ttl`, `router: { forms }`, or the feature's own plugin beside `ogygia()`).
