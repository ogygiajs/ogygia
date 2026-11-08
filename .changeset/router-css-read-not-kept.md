---
'@ogygia/core': patch
---

A router page's CSS in dev is no longer lost after one failed read of the router CSS registry: the next render reads it again (#249).
