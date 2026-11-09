---
'@ogygia/devtools': patch
---

The profiler's Postgres and Redis stores connect and set up once: a setup that fails at the first write is tried again by the next one instead of breaking the store until a restart, and two first calls at once share one client (#197).
