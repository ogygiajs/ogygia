---
'@ogygia/machine': patch
---

`@ogygia/machine`: `queue()` with no `now` reads its deadlines on `clock.mono()`, like every other primitive, so a run that drives the clock drives the queue too.
