---
'@ogygia/machine': patch
---

A keyed flights no longer holds every symbol used as a key field forever: a symbol made at run time is freed once nothing else holds it, and a registered one is spelled by its name (#357).
