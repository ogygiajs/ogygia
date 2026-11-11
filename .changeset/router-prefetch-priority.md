---
'@ogygia/core': patch
---

A click on a link whose page prefetch still waits for its turn sends that request at high priority, the visitor's, instead of the prefetch's low one.
