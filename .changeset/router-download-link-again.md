---
'@ogygia/core': patch
---

A link the browser keeps the page on screen for (a file download, a 204) works on every click again, not only the first: the router's hand-off of a navigation to the browser now ends it, so a later click on the link no longer joins it and gets swallowed (#266).
