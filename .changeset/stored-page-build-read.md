---
'@ogygia/postrender': patch
---

A stored page is served only to the build that stored it, recorded in the new optional `build` field of the public `PostrenderEntry` type (a custom store keeps it as part of the entry): another build's page is a miss, so a rolling deploy's old instances can no longer hand the new release their pages, and pages stored before this release are rendered again once.
