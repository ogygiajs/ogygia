---
'@ogygia/reshape': minor
'@ogygia/core': minor
'ogygia': minor
'@ogygia/devtools': patch
---

breaking: an app's own pass over the HTML ogygia sends is the new `@ogygia/reshape` package: `ogygia.handle({ transform })` now throws `handle_transform_moved`; install `@ogygia/reshape`, list `reshape()` (from `@ogygia/reshape/vite`) beside `ogygia()` and use `sequence(reshape.handle(transform), ogygia.handle())` (the transform is its one argument, typed `ReshapeTransform`). `ogygia/markup` is removed (and `scanRegions` / `liftRegions` / `restoreRegions` leave `ogygia/server`); install `@ogygia/reshape` and import from it.
