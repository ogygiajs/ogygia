---
'@ogygia/core': patch
'@ogygia/compiler': patch
---

A remote query made outside any island (a click handler, a module's top level) right after the island that used the same query left the page now gets fresh data, not an empty answer.
