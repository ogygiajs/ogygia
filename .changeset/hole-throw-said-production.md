---
'@ogygia/core': patch
---

A hole whose server render throws is now said in production too (`region_render_failed`, with the error, in the server's log). It was said only in dev, so a hole that failed only in production answered 500 with nothing logged. The visitor's answer is unchanged: an opaque 500.
