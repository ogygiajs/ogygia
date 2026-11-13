---
'@ogygia/compiler': patch
---

A deferred or held region in a library component only the server bundle reaches gets its styles built: the client leg takes the server leg's final list of server regions, so the hole no longer shows unstyled.
