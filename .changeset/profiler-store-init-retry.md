---
'@ogygia/devtools': patch
---

A durable profiler store whose `init` fails once is tried again by its next use instead of being dropped for the life of the process (#289).
