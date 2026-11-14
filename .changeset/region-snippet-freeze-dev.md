---
'@ogygia/core': patch
---

In dev, `region.snippet(snippet)` now freezes a snippet that writes elements; before, Svelte's dev element check found no component around it and the freeze threw.
