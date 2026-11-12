---
'@ogygia/router': patch
---

`href()`, `api()` and `entries()` write a route's URL as Kit does: a `[...rest]` value keeps its slashes (each segment encoded, no more `%2F`), and an empty `[[optional]]` or `[...rest]` segment is dropped (`/a/b`, not `/a//b`). A rest value with an empty piece (a leading, trailing or doubled `/`) or a `.`/`..` piece throws, and so does a param that fills a segment other than the last one empty, so a filled URL never names another origin or another route.
