---
'@ogygia/core': patch
---

Every region response now says how it may be cached: a `keepFallback()` answer (204) carries its hole's own policy (`no-store`, or `private, max-age` when the hole opted in), and refusals and errors (403, 405, 400, 413, 429, 500) are `no-store`.
