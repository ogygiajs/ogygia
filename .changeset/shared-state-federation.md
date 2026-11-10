---
'@ogygia/core': major
'ogygia': major
'@ogygia/federation': minor
---

- `@ogygia/core`, `ogygia`: `SharedState` is no longer exported from `ogygia` or `@ogygia/core`. Import it from `@ogygia/federation/shared` instead; it works the same.
- `@ogygia/federation`: `SharedState` (state shared across separate builds on one page) is exported from `@ogygia/federation/shared`.
