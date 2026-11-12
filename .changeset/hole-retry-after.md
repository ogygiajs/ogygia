---
'@ogygia/core': patch
---

A deferred region the endpoint rate-limited no longer gives up for good: the endpoint's 429 now carries `Retry-After` (the time left in the visitor's window), and the region asks again after it (at most a minute) instead of spending its tries inside the window.
