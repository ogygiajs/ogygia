---
'@ogygia/federation': patch
---

After a thaw or a mutation, an old peer request ending no longer removes the newer one, so a read joins it instead of starting another upstream fetch (#210).
