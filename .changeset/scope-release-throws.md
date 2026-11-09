---
'@ogygia/machine': patch
---

A scope whose listener release throws on `close()` still lets go of the rest and runs every cleanup, then throws it (#346).
