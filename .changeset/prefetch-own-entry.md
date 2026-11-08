---
'@ogygia/core': patch
---

An old prefetch no longer forgets a newer prefetch of the same page when its slot comes up after a cache clear, so a click on that page lifts the newer one instead of waiting behind every other guess (#234).
