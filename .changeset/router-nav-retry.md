---
'@ogygia/core': patch
---

The router's navigation code that fails to download is asked for again under a fresh URL: the next click, `invalidateAll`, `invalidate` or `preloadData` loads it, instead of links falling back to full page loads and refreshes failing until a reload (#238).
