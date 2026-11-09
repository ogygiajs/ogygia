---
'@ogygia/core': patch
---

A region stylesheet whose download failed is asked for again by the next answer that carries it, which waits on that download only: the region no longer stays unstyled for the rest of the tab, nor waits 5 s on a sheet that never loads (#274).
