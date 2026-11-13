---
'@ogygia/core': patch
---

A streamed `page.data` promise read again after its value arrived (two regions sharing it, a lazily woken island) is the same settled promise, no longer rejected as `page_promise_unresolved`.
