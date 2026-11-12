---
'@ogygia/core': patch
---

A static live region no longer paints a tick over a newer update of the same region (a command that returned it) that landed while the tick was on its way, nor a tick whose data version is older than the one on screen.
