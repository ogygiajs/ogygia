---
'@ogygia/devtools': patch
---

A recorded session (the Record tab, `@ogygia/testing`'s `record()`) goes on across a full page load when the browser keeps the page it left in its back-forward cache, and a page restored from that cache records on.
