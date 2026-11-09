---
'@ogygia/core': patch
---

Concurrent requests for one cached hole (a `maxAge` region) now share one render instead of each rendering it and taking a render slot; a failed render fails the requests that joined it and is not stored (#244).
