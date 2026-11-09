---
'@ogygia/machine': patch
---

A scope task whose work closes its own scope before it returns (moves its machine on) settles with `STALE` instead of hanging (#349).
