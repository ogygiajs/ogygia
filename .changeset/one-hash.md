---
'@ogygia/core': patch
---

`import.meta.og.bake` addresses each evaluated bundle by a 64-bit hash of its inputs (was 32-bit), so two modules can no longer share a cached bake by collision.
