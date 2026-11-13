---
'@ogygia/core': patch
'@ogygia/devtools': patch
---

A hydration mismatch report drops a comment where the browser ends it (`--!>`, `<!-->`), and keeps a `<!--` inside a script or a quoted value.
