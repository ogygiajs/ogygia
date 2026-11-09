---
'@ogygia/core': patch
---

The router writes a history entry only when a page goes in: download and 204 clicks add none, and a download sent as HTML (`Content-Disposition: attachment`) is saved, not swapped into the page (#297).
