---
'@ogygia/core': patch
---

A client navigation to a page at another URL depth no longer adds a second copy of a head tag (the ogygia runtime script, a stylesheet) that the first page wrote with a page-relative URL.
