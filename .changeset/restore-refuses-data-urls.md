---
'@ogygia/rewrite': patch
---

The restorer refuses a `data:` URL in an attribute reset (`og-r`), as it refuses `javascript:` and `vbscript:`, and reads each value's scheme the way a browser's URL parser does (the same check as core's `html`).
