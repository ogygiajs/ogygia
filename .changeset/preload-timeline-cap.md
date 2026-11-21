---
'@ogygia/core': patch
---

Island code no longer waits up to 2.5 s for a critical preload that already arrived on a page whose browser resource timeline had filled (250 entries): the runtime keeps its own record of finished downloads.
