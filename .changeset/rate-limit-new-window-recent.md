---
'@ogygia/core': patch
---

A visitor whose rate-limit window rolled over counts as recently seen, so under pressure it is no longer the first address let go (and handed a fresh budget).
