---
"@ogygia/postrender": patch
---

A store that fails during invalidation is reported as a store failure, and the edges still purge (a throwing `evictByTag` stopped the whole invalidation and was blamed on the edge).
