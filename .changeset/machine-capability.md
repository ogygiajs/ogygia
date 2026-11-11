---
'@ogygia/machine': minor
---

machine: `capability()` makes signed, expiring tokens addressed to an audience: length-prefixed messages that name the capability and its version, a lifetime clamped at mint and refused past its bound at check, a random nonce with optional one-time use in bounded memory, and no token from a clock that reads NaN; the signer (HMAC, Ed25519) is the caller's
