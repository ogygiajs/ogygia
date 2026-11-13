---
'@ogygia/postrender': patch
---

A stored page answers `If-None-Match` with the weak comparison RFC 9110 asks for: a `W/` etag a compressing CDN made, and `*`, now revalidate with a 304 (before, only the exact strong etag did, so such revalidations sent the whole page).
