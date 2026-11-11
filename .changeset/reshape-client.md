---
'@ogygia/core': patch
'@ogygia/reshape': patch
---

- `@ogygia/core`: the runtime no longer carries the restore support for an app's own HTML pass (the restore report, a web component's class tokens through hydration, the answer restore hooks); apps without `@ogygia/reshape` boot about 0.15 to 0.2 kB (brotli) smaller.
- `@ogygia/reshape`: `reshape()` now ships that support to the browser itself; `restore_markup_broken` and `restore_late` are its message codes now.
