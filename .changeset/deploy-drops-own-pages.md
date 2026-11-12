---
'@ogygia/postrender': patch
---

A deploy now counts as a write for the app's own stored pages: on the first request after a boot with a new build, the pages the previous build stored are dropped (origin and edges) before any is served, so a new release never serves the old release's HTML.
