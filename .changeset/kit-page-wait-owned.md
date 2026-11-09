---
'@ogygia/core': patch
---

On a Kit-hydrated page, the wait for Kit's page ends once no island waits for it: an island that leaves the page while it waits no longer keeps the wait going (its timers and its watch of Kit's page).
