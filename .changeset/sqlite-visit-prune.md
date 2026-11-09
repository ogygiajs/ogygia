---
'@ogygia/devtools': patch
---

The profiler's SQLite store prunes a page's visits by walking its index past the kept ones, instead of rebuilding the whole kept set on every write.
