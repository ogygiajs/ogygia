---
'@ogygia/devtools': patch
---

The profiler's Redis store, given a URL, fails with node-redis's own connection error (a wrong password, an unreachable host) instead of "Cannot find package 'ioredis'".
