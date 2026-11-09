---
'@ogygia/testing': patch
---

`record()` whose actions fail throws their error even when an undo (the navigation blocker's or the server window's stop) fails after them, instead of the undo's (#372).
