---
'@ogygia/core': patch
'ogygia': patch
---

On a router (non-navigate) request, `$page.data` with promises keeps its key order in the seed; before, keys came in the order their values settled.
