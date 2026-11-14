---
'@ogygia/core': patch
---

`html` and `attr` read a URL attribute's scheme the way a browser's URL parser does: a value a browser follows as a relative URL (a space before the colon, as in `javascript :x`, or a leading non-ASCII space) is kept, not replaced with `about:invalid#unsafe`; every value a browser would run as `javascript:`, `vbscript:` or `data:` is still refused.
