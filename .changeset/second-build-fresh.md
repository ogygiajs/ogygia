---
'@ogygia/compiler': patch
---

A second build in one process (`vite build --watch`, or `build()` called twice) scans the app again and reads each route's `csr` afresh, so a region added or a `csr` flipped between builds is in the next build.
