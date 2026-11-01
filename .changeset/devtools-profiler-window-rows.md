---
"@ogygia/devtools": patch
---

The profiler's sqlite, redis and postgres stores keep a whole recording window (2000 requests per key); they kept the newest 20.
