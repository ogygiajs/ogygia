---
'@ogygia/postrender': patch
---

A remote function call (a `query` or `query.live`) made from a stored page is no longer answered with the stored page's HTML, and is never stored as the page: postrender stores and serves page requests only.
