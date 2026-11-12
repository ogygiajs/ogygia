---
'@ogygia/core': patch
---

A soft refresh (`invalidateAll`, as a remote form runs) while a client navigation waits on the next page's stylesheet no longer takes that sheet out, so the navigation goes in as soon as the sheet loads instead of after the 2 s cap, and the next page is not shown unstyled.
