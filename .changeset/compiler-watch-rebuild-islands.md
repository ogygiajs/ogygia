---
'@ogygia/compiler': patch
---

A second client build in one process (`vite build --watch`) emits every island entry again and writes full location maps: it emitted none, so the rebuilt pages could not load their islands.
