---
'@ogygia/federation': minor
---

federation: a signed call also carries one capability token (`x-og-cap`): method, path, body hash, claims and audience as length-prefixed fields, a nonce that checks once, signed with Ed25519; a receiver checks a call that has one by it alone, and still accepts a call with only the legacy headers (`x-og-ts`, `x-og-n`, `x-og-sig`) from a peer that has not upgraded yet
