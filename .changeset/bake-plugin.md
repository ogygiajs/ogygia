---
'@ogygia/bake': minor
'@ogygia/compiler': minor
'@ogygia/core': minor
---

`import.meta.og.bake` moves to its own package: install `@ogygia/bake`, list `bake()` beside `ogygia()`, and reference `@ogygia/bake/types`; without the plugin a bake call fails the build with `macro_needs_plugin`.
