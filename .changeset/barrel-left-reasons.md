---
'@ogygia/core': patch
'@ogygia/devtools': patch
---

- `@ogygia/core`: the dock's `island-barrel` finding says why `barrels()` left the barrel (it runs code of its own, it is a package the plugin does not list, an import of it marks a region, and so on) with the fix for that reason, and names `barrels()` from `@ogygia/barrels` when the app does not list it.
- `@ogygia/devtools`: the profiler's `island-barrel` warning quotes the same reason, recorded by the build, and its fix names `barrels()` instead of the removed `ogygia({ barrels })`.
