---
'@ogygia/core': patch
---

A region refresh that starts while a first fetch of the same hole is still out stops that fetch, and the regions that waited on it get the refreshed HTML.
