---
'@ogygia/content': patch
---

An entry's `body` (and a format's and a source's) is typed as the `AwaitableRegion` it is, so `await entry.body` type-checks without a cast.
