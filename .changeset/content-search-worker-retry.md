---
'@ogygia/content': patch
---

The search worker downloads its index again for the next query after a failed download, instead of failing every query with the first error.
