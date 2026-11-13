---
'@ogygia/flags': minor
'@ogygia/compiler': minor
'@ogygia/cli': minor
---

The flag inventory (`node_modules/.ogygia/flags-manifest.json`) is now written by `flags()`: a build writes it only when `flags()` is listed beside `ogygia()`, and an app that imports `@ogygia/flags` without listing it gets a one-time `plugin_not_listed` build warning.
