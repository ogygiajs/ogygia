---
'@ogygia/content': patch
---

A folder sidecar (`+meta.json`, `index.md`) that fails to load once no longer breaks the collection and its groups until a restart: the next read loads it again (#246).
