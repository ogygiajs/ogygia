---
'@ogygia/core': patch
---

A hydrating region records its `<head>` content from what it added, not by copying and scanning the whole `<head>`: on a 250-region page with a large head this takes about 0.15 ms instead of about 58 ms.
