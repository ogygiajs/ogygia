---
'@ogygia/core': patch
---

Hole renders never run above the concurrency limit: a freed slot goes straight to the next waiter, and a render past its timeout keeps its slot until it really ends (#195).
