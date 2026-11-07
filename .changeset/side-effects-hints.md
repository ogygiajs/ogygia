---
'ogygia': patch
'@ogygia/router': patch
'@ogygia/flags': patch
'@ogygia/testing': patch
'@ogygia/devtools': patch
'@ogygia/content': patch
---

Packages declare `sideEffects` (only their `.css` files run on import), so bundlers drop the modules an app never uses.
