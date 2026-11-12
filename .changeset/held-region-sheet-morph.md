---
'@ogygia/core': patch
---

A router navigation from a styled held region to an unstyled one in the same place no longer keeps the first region's `<link data-ogygia-region-css>` inside the second: a region's sheet counts as render output in the morph.
