---
'@ogygia/content': patch
---

One bad live update no longer stops live updates: the entry keeps its last good version, and a dropped live connection is opened again (after a doubling wait) and the whole source read again (#190).
