---
'@ogygia/core': patch
---

`@ogygia/core`: a router navigation groups the next page's deferred holes by endpoint, as the first load does. A peer widget's hole no longer sends the whole batch to its own path, which answered 403, and no region call is sent to an endpoint that does not know it.
