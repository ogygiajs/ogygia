---
'@ogygia/core': patch
---

A whole-body swap navigation keeps the objects the next page's seed revived: an island that decodes the same object as `page.data` gets that object, not a fresh copy.
