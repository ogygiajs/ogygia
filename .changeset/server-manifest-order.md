---
'@ogygia/compiler': patch
---

The server manifest lists its regions sorted by id, so two builds of one app give the same server chunk bytes whatever order the bundler transformed the pages in (#1399).
