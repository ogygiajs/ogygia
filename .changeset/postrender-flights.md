---
'@ogygia/postrender': patch
---

Requests waiting on a page render that a publish overtook are let go at once and share one new render, which is stored, instead of waiting for the old render to end and then each rendering the page alone.
