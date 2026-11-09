---
'@ogygia/core': patch
---

A region's mailbox runs any number of events queued in one turn on a flat stack, instead of overflowing it after a few thousand sync ones (#342).
