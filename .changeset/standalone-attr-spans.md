---
'@ogygia/devtools': patch
---

The profiler's standalone report reads a module script's `type` and `src` as the browser does (entities decoded, any quoting) and drops every copy of `src`, so a repeated `src` no longer makes the inlined runtime load a file instead of its own code.
