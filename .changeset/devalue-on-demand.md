---
'@ogygia/core': patch
---

A page whose islands get plain JSON props no longer downloads devalue: it loads only when a props sidecar, the page seed or page facts are in devalue's lane, beside the hydrate code (about 2 KB brotli off each island page of the benchmark).
