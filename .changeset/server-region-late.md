---
'@ogygia/compiler': patch
---

A deferred or held region in a file the build only reaches late (a library outside `src/` with no `ogygia.files`) is now served in production: the build fills in the server manifest from its final list of regions and gives a late region's loader its own chunk. Before, the region was missing from the manifest and its requests were refused (#1420).
