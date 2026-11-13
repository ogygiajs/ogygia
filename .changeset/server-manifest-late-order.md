---
'@ogygia/compiler': patch
---

A build lists its server regions by id in the values it writes at the end of the server leg (the manifest's maps, the late loaders, the page-data reads), so two builds of one app give the same server chunk bytes whatever order the bundler reached their hosts in.
