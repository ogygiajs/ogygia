---
"@ogygia/federation": patch
---

A fragment's image links now load from the peer on the shell: a `/cdn-cgi/image/…` link whose options hold commas stays one srcset candidate, and a `/_vercel/image?url=…` link (in `src`, `srcset` or a style's `url()`) is pinned to the peer's origin.
