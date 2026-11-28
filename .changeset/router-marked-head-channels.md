---
'@ogygia/core': patch
---

The SPA router no longer keeps the last page's marked side channel in the head (a server-router page's page seed or Kit env) when the next page carries one with the same text, so the next page's islands read their own page's channel.
