---
'@ogygia/core': patch
---

In dev, a file added next to a barrel that already re-exported it is now picked up by the barrels pass and the CSS walk, without restarting the dev server.
