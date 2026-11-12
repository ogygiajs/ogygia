---
'@ogygia/core': patch
---

`@ogygia/core`: the batch stream reader skips any number of malformed parcel openings in a loop, instead of running out of stack.
