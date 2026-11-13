---
'@ogygia/core': patch
---

The viewport tracker no longer keeps observing a region with no box of its own after it stops following it (for example once a navigation took the region off the page).
