---
'@ogygia/devtools': patch
---

The dock's "profile this page" waits out a busy profiler's long `Retry-After` up to its two-minute deadline (before, a wait past ~24 days failed the profile with `machine_bad_time`).
