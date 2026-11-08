---
'@ogygia/core': patch
---

Back from a page the router handed to the browser (a csr=true Kit page, a page that is not ogygia's) now loads the page before it: the router's history entry for the visit is replaced by the browser's document instead of reloaded, so the router page's entry no longer belongs to the new document (#259).
