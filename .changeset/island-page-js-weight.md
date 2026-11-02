---
"@ogygia/core": patch
---

An island page no longer downloads code it never runs: the server-side seed planner, the hub, the fn manifest, the remote-seed cache and the transportable-class loader stay out of apps that do not use them (the benchmark blog: 41.7 → 38.2 KB brotli).
