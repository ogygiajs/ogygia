---
'@ogygia/core': patch
---

The build's flag inventory takes time in line with a module's size: each flag's line is found from one pass over the file, not counted again from the top.
