---
'@ogygia/compiler': minor
---

The retired `partial` import attribute no longer has its own build error: `with { partial: … }` is not a region mark and leaves a plain import. Write `region: 'raw'` for a held component, or `wake: …` for an island.
