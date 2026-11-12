---
'@ogygia/core': patch
---

A server island's address is a path from the app's root (`/__ogygia__?…`, under `paths.base` when set), never relative to the page, so it still works in HTML that moves to another page or app under Kit's default `paths.relative`.
