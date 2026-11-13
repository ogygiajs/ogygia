---
'@ogygia/devtools': patch
'@ogygia/federation': patch
'@ogygia/core': patch
---

A request body that breaks off mid-upload is a 400 on the profiler's login and on the federation routes (the exposed table, a thaw notice), not a thrown error and a 500.
