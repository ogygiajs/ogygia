---
'@ogygia/compiler': patch
---

A build warns (`runtime_marks_late`) when a file it first reaches while bundling places a region that needs a runtime feature the build already left out, naming the file and the feature (#1452).
