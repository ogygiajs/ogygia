---
'@ogygia/compiler': patch
---

The `og.$` fn-manifest is written sorted by tag, so two builds of the same app give the same runtime chunk whatever order the bundler transformed modules in.
