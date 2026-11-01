---
"@ogygia/postrender": patch
---

A stored page older than the policy `ttl` is a miss on read, so a store without its own expiry still ages pages out.
