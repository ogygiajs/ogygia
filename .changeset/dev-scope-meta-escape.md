---
'@ogygia/core': patch
---

In dev, a route group whose name holds a quote mark or an ampersand gets its edited stylesheets live again: the dev-scope meta now escapes the name instead of dropping its quotes.
