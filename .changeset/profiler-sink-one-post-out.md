---
'@ogygia/devtools': patch
---

A profiler sink that is down holds one post at a time: the rows read meanwhile wait in the capped buffer (which drops the oldest when full) and go in one post after it, instead of a post queued per tick without a bound (#376).
