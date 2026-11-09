---
'@ogygia/postrender': patch
---

A store outage is said once (`postrender_store_failed`) even while calls overlap: a slow store call that started before the outage and answers after it no longer ends the failing streak (#364).
