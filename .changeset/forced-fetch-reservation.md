---
'@ogygia/core': patch
---

A forced refresh at an address a navigation batch reserved no longer orphans the holes that joined the batch: they wait on the refresh, which settles them with the first frame written there or fails them with its own error, and a hole that binds after the batch ended fetches on its own (#233).
