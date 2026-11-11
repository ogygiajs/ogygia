---
'@ogygia/devtools': patch
---

A production profiler with no secret takes no window id (`x-og-window`): it writes no request to the store under one. The fixed dev key is used in dev only.
