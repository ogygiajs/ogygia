---
'@ogygia/core': patch
---

A lazy chunk whose own dependency failed to download is asked for again once, not on every later wake: the runtime then says once that the page needs a reload (`chunk_reload_needed`), and a runtime that fails to load at all now says so too (`runtime_load_failed`) (#262).
