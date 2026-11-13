---
'@ogygia/rewrite': minor
'@ogygia/core': minor
'ogygia': minor
'@ogygia/devtools': patch
---

breaking: an app's own pass over the HTML ogygia sends is the new `@ogygia/rewrite` package: `ogygia.handle({ transform })` now throws `handle_transform_moved`; install `@ogygia/rewrite`, list `reshape()` (from `@ogygia/rewrite/vite`) beside `ogygia()` and use `sequence(reshape.handle(transform), ogygia.handle())` (the transform is its one argument, typed `ReshapeTransform`). `ogygia/markup` is removed (and `scanRegions` / `liftRegions` / `restoreRegions` leave `ogygia/server`); install `@ogygia/rewrite` and import from it.
