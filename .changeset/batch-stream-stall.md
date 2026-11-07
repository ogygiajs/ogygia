---
'@ogygia/core': patch
---

A batch stream that goes quiet for 10 seconds is given up: the holes it still owes fetch on their own instead of keeping their fallback forever (#214).
