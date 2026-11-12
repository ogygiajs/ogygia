---
'@ogygia/postrender': patch
---

A stored page's stitch holes are found as the browser reads the page: a region tag inside a fallback's comment, script, style, title or textarea text no longer shifts which part of the page a hole covers, so an edge (ESI) rewrite never wraps half a region.
