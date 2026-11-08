---
'@ogygia/core': patch
---

Hole renders never run above the concurrency limit: a freed slot goes straight to the next waiter, and a render past its timeout gives its slot to the next hole, so renders stuck on a hung upstream never block the others (#195).
