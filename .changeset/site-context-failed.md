---
'@ogygia/content': patch
---

`site()`: a `context` function that throws is now reported as `content_site_context_failed` (with the thrown error) instead of being swallowed. The request still reads the public pages only, as before.
