---
'@ogygia/core': patch
---

On a Kit-hydrated page, a deferred region whose props hold a shared object (a wired class instance, a store) now has the same identity in the browser as on the server, so a region Kit mounts afresh finds its server-minted address and loads.
