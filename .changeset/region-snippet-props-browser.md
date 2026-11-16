---
'@ogygia/core': patch
---

A hole given a snippet prop now works in the browser, as it does on the server: created fresh in the browser it freezes the snippet to HTML itself, and hydrated on a csr page it keeps the server's frozen HTML, instead of throwing `prop_not_serializable`.
A top-level island given a snippet prop and created fresh in the browser now freezes the snippet to HTML, as the server does, instead of throwing `prop_not_serializable`.
