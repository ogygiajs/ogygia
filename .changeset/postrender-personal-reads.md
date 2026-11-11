---
'@ogygia/postrender': minor
'@ogygia/core': patch
---

`@ogygia/postrender`: **Breaking:** a page rendered for a request that carries a cookie or an `authorization` header is not stored (it is still served a stored copy, and its own render is stamped `private, no-store`); a route whose pages are the same with them opts in with `config = { postrender: 'with-credentials' }`. `@ogygia/core`: a render's per-visitor reads also count a function in `locals`, `in` and the keys of `locals`, the request headers read whole or copied while one is personal, `headers.has()` and a request `clone()`, client address, forwarded host, location and session headers, `getClientAddress()`, per-request `platform` data, and an own-origin `fetch` that carries the visitor's cookies.
