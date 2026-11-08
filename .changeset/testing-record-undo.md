---
'@ogygia/testing': patch
---

`record()` that fails early stops its server window, untags the requests and lifts the navigation blocker, so the next `record()` starts at once (#291).
