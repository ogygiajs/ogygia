---
'@ogygia/compiler': patch
---

The dev server sees a file change even after more than 100,000 cached compiler answers: the cache no longer drops what a file read, only answers computed from it.
