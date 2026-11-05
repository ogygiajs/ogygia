---
'@ogygia/core': patch
---

`ogygia.extensions()` and `ogygia.preprocess()` from `ogygia/vite` are callable again and do nothing (`['.svelte']` and `[]`), so a svelte config written for 0.8 loads; the markdown ones come from `@ogygia/content/vite`.
