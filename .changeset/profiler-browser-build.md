---
'@ogygia/devtools': patch
---

An app with the profiler on (`devtools({ profiler: true })`) builds for production again: the profiler's islands no longer import a server module, which failed the browser build with `virtual_wrong_realm`.
