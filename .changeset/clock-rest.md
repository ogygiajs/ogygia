---
'@ogygia/postrender': patch
'@ogygia/federation': patch
'@ogygia/devtools': patch
'@ogygia/testing': patch
'@ogygia/cli': patch
---

Durations are measured on the monotonic clock: the memory store's TTLs, a federation deploy check's retry wait, the profiler's recording window, deadlines and busy waits, the testing API's wait, and the perf CLI's waits. A wall-clock step no longer moves them.
