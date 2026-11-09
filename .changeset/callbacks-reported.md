---
'@ogygia/core': patch
---

An app's callback that throws (a `beforeNavigate` or `afterNavigate` hook, a page store subscriber, a ref watcher or disposer, a source receipt seam, a devtools sink) now reaches the page's error handler (`reportError`), or the console on a server, instead of being dropped; the others still run.
