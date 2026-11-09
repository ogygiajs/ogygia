---
'@ogygia/core': patch
---

Handing out hydrate turns costs the same per region however many are waiting: a page with 250 `load` regions spends about a third of the time scheduling them, 2,500 regions about a twentieth.
