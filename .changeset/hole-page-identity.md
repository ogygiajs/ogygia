---
'@ogygia/core': patch
---

A hole with `maxAge` whose render reads `page.data` or calls a remote query is kept in the server's render cache again: the page it renders for is part of its key, not a read about the visitor.
