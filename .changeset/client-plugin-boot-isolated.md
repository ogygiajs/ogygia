---
'@ogygia/core': patch
---

A plugin whose browser `boot` throws no longer stops the runtime's boot: it is reported once (`client_hook_failed`, hook `boot`), the other plugins still boot, and the page's regions still wake.
