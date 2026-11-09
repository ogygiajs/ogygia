---
'@ogygia/core': patch
---

A batch hole stream whose visitor leaves now stops: the holes not rendered yet never render or take a render slot, and the answers that land after it are dropped instead of thrown into the closed stream (#245).
