---
'@ogygia/core': patch
'@ogygia/federation': patch
---

The region batch endpoint and federation's routes stop reading a request body once it passes their size cap, also when it is sent without a `content-length` (before, such a body was read whole, then refused).
