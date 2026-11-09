---
'@ogygia/devtools': patch
---

The server's first requests that arrive together now mount one profiler instead of one each, and a profiler that failed to load is tried again by the next request instead of staying off until a restart (#242).
