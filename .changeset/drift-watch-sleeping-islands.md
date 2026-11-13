---
'@ogygia/core': patch
---

The check for edits to a sleeping island now watches only the islands still asleep, not the whole document, so DOM changes elsewhere on a large page (a framework hydrating it, web components rendering) no longer run the runtime's code.
