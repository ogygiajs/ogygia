---
'@ogygia/router': patch
---

`href()`, `api()` and `entries()` write a route's URL as Kit does: a `[...rest]` value keeps its slashes (each segment encoded, no more `%2F`), and an empty `[[optional]]` or `[...rest]` segment is dropped (`/a/b`, not `/a//b`).
