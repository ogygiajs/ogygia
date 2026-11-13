---
'@ogygia/core': patch
---

Past the region endpoint's rate-limit cap, an address whose window already ended is let go first: a visitor who spent their budget in a window still open no longer gets a fresh one early.
