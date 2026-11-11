---
'@ogygia/core': patch
---

When the file of an island nested in another island fails to download once, the retry now asks again for the outer island's own file, so the outer island is no longer replaced by the nested one.
