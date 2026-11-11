---
'@ogygia/core': minor
'ogygia': minor
'@ogygia/federation': minor
---

- `@ogygia/core`, `ogygia`: breaking: `SharedState` is no longer exported from `ogygia` or `@ogygia/core`. Import it from `@ogygia/federation/shared` instead; it works the same.
- `@ogygia/federation`: `SharedState` (state shared across separate builds on one page) is exported from `@ogygia/federation/shared`.
