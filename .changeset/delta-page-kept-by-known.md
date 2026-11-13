---
'@ogygia/core': patch
---

With `serverDelta` on, a page the router kept (a soft refresh's, a prefetch's) is reused only by a document that still shows the regions its fetch left out: going back to a page after a soft refresh on it no longer brings its regions in empty and fails to hydrate them.
