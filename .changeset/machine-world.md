---
'@ogygia/machine': minor
---

`world()`: a stamp that only moves forward (`stamp()`, `fresh(s)`, `bump()`), split by key with `world.keyed()` (`bump(keys)` puts out of date only what read those keys); `flights({ world, touches })` drops what a move touches and makes an answer whose world moved on its way `STALE` for every caller that joined it (#311).
