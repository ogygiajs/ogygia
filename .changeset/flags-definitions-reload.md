---
'@ogygia/flags': patch
---

In dev, a flag deleted from a module is gone once that module reloads: a flag source is no longer asked about it, and its layer no longer counts it.
