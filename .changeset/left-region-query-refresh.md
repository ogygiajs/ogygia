---
'@ogygia/core': patch
---

A remote query refreshed by an island's own handler after the island left the page (a click awaiting a command, then a navigation) is a no-op instead of Kit's "No cached query found" error; the next page still reads that query fresh.
