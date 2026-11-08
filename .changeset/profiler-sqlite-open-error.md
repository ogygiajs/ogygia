---
'@ogygia/devtools': patch
---

The profiler's SQLite store fails with the driver's own error when it cannot open its file, instead of saying it needs Node 22.5+ or better-sqlite3.
