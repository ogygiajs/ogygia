---
'@ogygia/core': patch
---

A hole whose `prefetch` warm still waits for a background turn fetches at once when it wakes on screen, the visitor reaches for it, or `preload()` asks for it, instead of waiting behind the page's other prefetches.
