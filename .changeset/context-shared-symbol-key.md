---
'@ogygia/core': patch
---

A `Symbol.for(name)` context key, set with `setContext` from `ogygia` or in a `<Provide>`'s values, now reaches regions in the browser: it crosses by its name. Before, the drop-in `setContext` left it out and a `<Provide>` holding one failed to render.
