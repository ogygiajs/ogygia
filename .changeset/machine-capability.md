---
'@ogygia/machine': minor
---

machine: `capability()` makes signed, expiring tokens addressed to an audience: length-prefixed messages that name the capability and its version, a lifetime clamped at mint and refused past its bound at check, a random nonce with optional one-time use in bounded memory, and no token from a clock that reads NaN; the signer (HMAC, Ed25519) is the caller's, and a check may bring its own verify (keys in rotation); `skew` allows for two machines' clocks; `nonce: false` mints the same token for the same inputs (not single-use, so `replay` is refused with it)
