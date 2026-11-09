---
'@ogygia/machine': minor
---

`flights()`: keyed async work that callers share (one flight per key, kept as long as `keep` says, `max`/`weigh`, `drop`, `fresh` revalidation, work stopped when its last caller leaves, and a failure never kept), in place of `once()`, which is a flights with one key.
