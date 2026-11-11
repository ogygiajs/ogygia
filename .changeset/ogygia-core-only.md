---
'ogygia': minor
---

breaking: `ogygia` depends only on `@ogygia/core` and `@ogygia/compiler`, and no `ogygia/*` path forwards to a plugin package. `ogygia/insights` is removed: install `@ogygia/insights` and import from it (same names).
