---
'@ogygia/core': patch
---

`preload()` of a hole fetches it the way the hole does: a `keepFallback()` answer keeps the fallback instead of wiping it, a page or a redirect is refused, and a renewed capability is kept (#212).
