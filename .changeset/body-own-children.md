---
"@ogygia/core": patch
---

A client-side navigation no longer removes nodes the page's own code put in `<body>` (a popover portal's anchor, a toast host), so a popover in an island the navigation keeps still opens afterwards; only the server's body children and attributes are replaced.
