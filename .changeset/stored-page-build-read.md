---
'@ogygia/postrender': patch
---

A stored page is served only to the build that stored it (its entry's new `build`): another build's page is a miss, so a rolling deploy's old instances can no longer hand the new release their pages, and pages stored before this release are rendered again once.
