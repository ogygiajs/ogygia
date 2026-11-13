---
'@ogygia/core': patch
'@ogygia/devtools': patch
---

Turning devtools on or off with `?og-devtools=on|off` drops the param through the router, so its history keeps the page's real address (a click back to the same page no longer reads as a navigation to another).
