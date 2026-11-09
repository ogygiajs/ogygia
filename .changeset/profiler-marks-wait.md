---
'@ogygia/devtools': patch
'@ogygia/core': patch
---

A profiler `mark()` made before the page's beacon loads now waits for it however late it comes, instead of being dropped after 10 s; the beacon takes the waiting marks as it loads (#369).
