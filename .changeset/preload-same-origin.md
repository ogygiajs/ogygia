---
'@ogygia/core': patch
---

`preload(region)` sends no request when the region's address is another origin; every fetch of a hole now checks its endpoint is this origin before it goes out.
