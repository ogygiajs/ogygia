---
'@ogygia/core': patch
---

A hole kept across a navigation keeps its stylesheet: a region sheet stays in the head while a region on the new page still uses it, instead of going with the head merge because the new page's server head does not list it (#275).
