---
'@ogygia/compiler': patch
---

In dev, a region module (a lake's wrapper) that was loaded while no file held it, after a missed file-watcher event, is reloaded once a later save gives it a host, instead of staying empty until a restart.
