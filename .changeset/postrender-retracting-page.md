---
'@ogygia/postrender': patch
---

A page whose render was stored just after a publish evicted it is no longer served while it is taken back out, and that evict is now tried again when the store fails it (#332).
