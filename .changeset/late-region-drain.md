---
'@ogygia/router': patch
---

A streamed page drains its late regions until nothing new registers: a late region that resolves to a region holding another promise region streams that one down the same response too, instead of leaving an empty slot nothing fills (#199).
