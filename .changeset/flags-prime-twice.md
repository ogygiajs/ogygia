---
'@ogygia/flags': patch
---

A second `prime_flags` of a request while the first still waits on the source now waits for that answer, instead of returning at once and leaving reads on the native rule (#296).
