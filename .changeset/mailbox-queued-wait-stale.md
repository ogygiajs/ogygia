---
'@ogygia/core': patch
---

A region whose element leaves the page while one of its waits is queued behind another event ends that wait with `STALE`, instead of leaving it (and the wake or live tick around it) unsettled for good (#373).
