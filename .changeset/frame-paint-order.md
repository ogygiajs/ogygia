---
'@ogygia/core': patch
---

The newest frame a region gets paints last: an older live tick or hole refresh still waiting for its stylesheet no longer paints over a newer one that needed none (#231).
