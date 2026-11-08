---
'@ogygia/devtools': patch
---

A profiler that cannot start (an edge runtime without `node:inspector`, a profiler module that fails to load) now prints `devtools_profiler_mount_failed` once, instead of leaving every request unprofiled without a word.
