---
'@ogygia/core': patch
---

A client navigation that removes one of two regions sharing one live object (a wired class instance, a store) no longer disposes that object while the other region stays on the page.
