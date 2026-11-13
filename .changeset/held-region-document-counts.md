---
'@ogygia/core': patch
---

A held region rendered in a `load` or by a remote call during the page render no longer mints slot ids the page's own regions also use, and no longer skips more copies on a server-delta navigation than the browser has live.
