---
'@ogygia/compiler': patch
---

A portable snippet now captures a host name read by a legacy `let:` directive's default (`let:item={[a = d]}`) instead of failing with a ReferenceError when it renders.
