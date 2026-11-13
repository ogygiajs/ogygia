---
'@ogygia/devtools': patch
---

Stopping a devtools recording no longer removes a `console.error` wrapper the page added while it recorded (an error reporter keeps seeing console errors).
