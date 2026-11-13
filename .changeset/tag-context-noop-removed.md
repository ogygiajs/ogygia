---
'@ogygia/compiler': minor
'@ogygia/core': minor
---

The build no longer appends a registration call after each exported `createContext(...)`, and the no-op `__tag_context` it called is gone from `ogygia` and `ogygia/internal`: a module that exports only contexts is left exactly as written. Rebuild any package that shipped already-transformed output.
