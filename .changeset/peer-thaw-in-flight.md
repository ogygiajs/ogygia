---
'@ogygia/federation': patch
---

A thaw drops only the peer documents it names: a fetch already out for another fragment is kept when it lands, and a caller whose fetch a thaw or a mutation made stale reads the page again instead of getting the old one (#294).
