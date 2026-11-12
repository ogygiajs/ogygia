---
'@ogygia/core': patch
---

A router prefetch no longer imports a lake's or a server-only hole's entry as a module: the page asked the server for `/<region id>` twice and ended in `chunk_reload_needed` (a hole nested in an island, after a client navigation).
