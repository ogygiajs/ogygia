---
'@ogygia/core': patch
---

A region's mailbox hands each handler a turn of its own: a wait from a handler that does not hold the turn (two waits at once, a timer it left behind) no longer ends another handler's turn and lets two events of one element run at once (#341).
