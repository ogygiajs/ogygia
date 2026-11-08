---
'@ogygia/core': patch
---

Barrel imports in dev now resolve each leaf with the environment that asked: a leaf the client and the server resolve to different files (by conditions) no longer gets the other one's file, from a transform running at the same time or from the cached barrel map (#252).
