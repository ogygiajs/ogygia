---
'@ogygia/devtools': patch
---

The profiler stops reading the copy of an outbound body it counts when the request that made the call ends, so a body that never ends is not read for good.
