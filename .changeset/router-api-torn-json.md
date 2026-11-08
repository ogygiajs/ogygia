---
'@ogygia/router': patch
---

`api()` rejects when a successful answer's JSON body does not parse, instead of resolving `undefined`.
