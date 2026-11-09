---
'@ogygia/core': patch
---

A region that leaves the page before its `load` schedule fires starts nothing: no fetch of a hole's answer off the page (which then gave up and reported a failure), and no wake of its island (#335).
