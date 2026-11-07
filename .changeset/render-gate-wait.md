---
'@ogygia/core': patch
---

A hole waits at most the render timeout for a free render slot, then answers with its fallback instead of waiting forever behind renders that do not end (#195).
