---
'@ogygia/core': patch
---

A forced refresh at an address a navigation batch reserved no longer orphans the holes that joined the batch: the first frame written there settles them, and a batch that ends without one lets them fetch on their own (#233).
