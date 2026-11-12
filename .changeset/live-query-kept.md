---
'@ogygia/core': patch
---

A live query in an island now keeps updating after a client navigation that keeps the island; the navigation releases only the query instances that departed islands held.
