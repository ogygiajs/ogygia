---
'@ogygia/core': patch
---

An island waiting for Kit's page on a Kit document now ends its wait with `kit_boot_failed` when one of the page's own Kit files (a route node) fails to load, not only Kit's entry files: it no longer waits forever.
