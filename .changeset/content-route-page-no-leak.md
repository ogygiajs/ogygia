---
'@ogygia/content': patch
---

A markdown route page (`+page.svx`, `+layout.md` under `kit.files.routes`) no longer warns `content_leaked_to_client`: it is the page itself, not a collection's document shipped to the browser. A collection's document named like one outside the routes folder still warns.
