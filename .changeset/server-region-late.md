---
'@ogygia/compiler': patch
---

A build stops with `server_region_late` when a deferred or held region sits in a file the build only finds after it wrote its server-region list (a library outside `src/` with no `ogygia.files`): before, the build passed and that region's requests were refused in production (#1420).
