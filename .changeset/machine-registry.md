---
'@ogygia/machine': minor
---

New `registry()`, `registry.keyed()` and `moduleLife(import.meta.hot)`: owned entries that leave with their owner, never evicted, and definitions owned by the defining module's run; `cache()` takes `pinned(value, key)` for values in use that never go for size.
