---
'@ogygia/core': patch
---

A region whose `wake` is not a trigger (a typo like `visable`, or a value computed at runtime through `region()`'s options) now wakes on load, as an unknown fetch schedule already did. It was taken for a media query that never matches, so the region never woke.
