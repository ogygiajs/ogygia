---
'@ogygia/core': patch
---

A deferred region whose fetch fails while the browser is offline, or an island whose code fails to download then, now tries again once the browser is back online instead of giving up for the life of the page; a region that finally gives up says `region_fetch_failed` in production too.
