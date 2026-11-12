---
'@ogygia/machine': minor
---

`queue()` hands each started job its own place: `start(job, place)`, given back with `place.release()`, once (a second release frees no other job's place). `queue.release()` is gone. A `start` that throws now gives its place back, so the jobs after it still get one.
