---
'@ogygia/devtools': patch
---

The devtools dock's server profile stops asking a busy profiler once its tab is left or the dock closes, follows the busy answer's `Retry-After`, and waits as long as the profiler's run page does (one shared wait) (#368).
