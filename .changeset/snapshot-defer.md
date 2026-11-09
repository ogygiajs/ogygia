---
'@ogygia/core': patch
---

A region's viewport snapshot is held by its lifetime with one cleanup instead of a scope of its own, so a hydrate turn costs about what it did before the scheduler moved onto scopes.
