---
'@ogygia/content': patch
---

An edit in dev no longer leaves another live connection open: a collection its module's next run replaces closes its connection, clears its retry and leaves the graph (#247).
