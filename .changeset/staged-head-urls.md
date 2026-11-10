---
'@ogygia/core': patch
---

A router navigation between pages at different URL depths asks for the next page's stylesheets (and every other head URL) at the next page's address, not resolved against the page being left.
