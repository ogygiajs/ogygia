---
'@ogygia/core': patch
---

Compiling a page now takes time in line with its region count. It used to grow with the square: each region import walked the whole file again (a 2,000-region page took 33x the work).
