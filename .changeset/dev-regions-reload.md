---
'@ogygia/compiler': patch
---

In dev, a region added while the server runs reloads the runtime entry and every other module that read the regions, so its wake works without a restart (before, a page's first `idle` or `visible` region never woke until a restart) (#1376).
