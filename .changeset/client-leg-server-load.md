---
'@ogygia/compiler': patch
---

A browser build that loads one of ogygia's server modules by its resolved id now fails with `virtual_wrong_realm`, instead of getting the module's browser stand-in.
