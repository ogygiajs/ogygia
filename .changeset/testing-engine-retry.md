---
'@ogygia/devtools': patch
---

The testing engine behind `__ogygia_testing` that fails to download is asked for again under a fresh URL by the next call, instead of every call failing until a reload (#241).
