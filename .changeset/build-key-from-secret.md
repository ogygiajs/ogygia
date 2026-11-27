---
'@ogygia/compiler': patch
---

A build with `OGYGIA_SECRET` set writes the same server bundle every time: the key it bakes in is derived from the secret, not drawn at random, so two builds of one source and secret are byte-identical.
