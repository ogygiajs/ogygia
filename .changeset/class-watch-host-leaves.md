---
'@ogygia/core': patch
---

On a Kit-hydrated page, a custom element Kit removes (and mounts anew) leaves the class watch, and the watch's observer goes once no host is left, instead of holding the removed hosts for good (#281).
