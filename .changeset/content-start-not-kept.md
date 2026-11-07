---
'@ogygia/content': patch
---

A collection whose first load fails (the source down, its init or a schema check failing) no longer keeps the failure: the next read loads it again (#189).
