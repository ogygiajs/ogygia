---
'@ogygia/federation': patch
---

`@ogygia/federation`: a signed request's `x-og-sig` is accepted only as the canonical base64 of its 64 bytes, so every copy of a signature counts as the same one.
