---
'@ogygia/core': patch
---

A transportable class whose module fails to download is asked for again: the next island that carries it loads it under a fresh URL and decodes it, instead of every later island decoding without the class until a reload (#237).
