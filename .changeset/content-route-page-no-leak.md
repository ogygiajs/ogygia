---
'@ogygia/content': patch
---

A markdown route page (`+page.svx`, `+layout.md`) no longer warns `content_leaked_to_client`: it is the page itself, not a collection's document shipped to the browser.
