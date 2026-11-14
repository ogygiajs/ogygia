---
'@ogygia/core': patch
---

An island prop that matches a page seed node only up to `-0` versus `0`, or an empty array slot versus `undefined`, now crosses as its own copy, so the island gets back exactly what it was given.
