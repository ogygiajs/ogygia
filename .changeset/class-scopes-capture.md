---
'@ogygia/compiler': patch
---

A portable snippet or `import.meta.og.$` closure now captures a host name read after a class whose `static {}` block declares the same name, and no longer captures a class expression's own name read inside it.
