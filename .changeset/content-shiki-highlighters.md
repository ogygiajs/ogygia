---
'@ogygia/content': patch
---

A Shiki theme object with no `name` now highlights (it is named from its contents), two such themes no longer share a highlighter or a fence-cache key, a theme object edited in place is a new fence-cache key, and snippets or alternating `highlight()` configs reuse one highlighter per set of themes and languages instead of making a new one each time (#366).
