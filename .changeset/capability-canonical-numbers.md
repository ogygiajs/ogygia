---
'@ogygia/core': patch
---

A region capability's `exp` and `ttl` are accepted only as ogygia mints them (plain digits, no leading zero) and refused as `shape` before the signature check otherwise (before, any spelling of the same expiry, such as `+n`, `0n`, `n.0` or `0x…`, verified, so one capability had many URLs).
