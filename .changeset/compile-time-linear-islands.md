---
'@ogygia/core': patch
---

Compiling a page with many regions is up to 1.9x faster: each region import no longer walks the whole file again to learn whether it is used.
