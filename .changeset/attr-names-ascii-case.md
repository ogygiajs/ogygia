---
'@ogygia/core': patch
'@ogygia/federation': patch
---

`@ogygia/core`: Tag and attribute names read from server HTML are lower-cased the way a browser does it, ASCII letters only, so `data-Äsrc` and `data-äsrc` count as two attributes.
`@ogygia/federation`: A peer tag with two attributes whose names differ only past ASCII (`data-Äsrc`, `data-äsrc`) now has each value pinned in its own attribute. Before, the first value was written into the second.
