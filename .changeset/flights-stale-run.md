---
'@ogygia/machine': patch
---

A flights run that answers `STALE` no longer leaves its key flying: nothing is kept, and the next `get` runs again (#377).
