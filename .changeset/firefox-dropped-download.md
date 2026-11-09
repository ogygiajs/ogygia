---
'@ogygia/core': patch
---

In Firefox a chunk or island file whose download was dropped is asked for again under a fresh URL, as in the other browsers: a resource-timing status of 0 now reads as no response (#388).
