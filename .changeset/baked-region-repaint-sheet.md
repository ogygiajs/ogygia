---
'@ogygia/core': patch
---

A held region the server baked with its stylesheet keeps its styles when it repaints with the same sheet (an island that reads the region's query again once it hydrates): the answer's sheet is now linked in the head whenever the head has none, not skipped because the old copy inside the region was still there.
