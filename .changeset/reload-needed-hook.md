---
'@ogygia/core': minor
---

A new client hook, `reloadNeeded({ url, error, regions })`, fires once per page when a chunk can load only after a reload, at the same moment the page says `chunk_reload_needed`. This happens when a download it needs failed (a dropped connection mid-load) and the browser keeps that failure for the page's life. `regions` are the regions whose own file the chunk is, so an app can offer the reload. A page with no subscriber carries none of its code.
