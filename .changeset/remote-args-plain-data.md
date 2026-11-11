---
'@ogygia/core': minor
---

breaking: a remote function's argument sent from the browser must be plain data. The server now refuses an argument that holds an ogygia value (a region, a snippet, a function, a wired class instance, a store or a derived store) with a 400 and `remote_arg_not_data`, and runs nothing. Values the server sends to the browser are unchanged.
