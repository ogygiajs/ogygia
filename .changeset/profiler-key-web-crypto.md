---
'@ogygia/devtools': patch
---

The profiler checks its key and session in constant time on every host, with Web Crypto; on a host without `node:crypto` login works and no plain comparison is used.
