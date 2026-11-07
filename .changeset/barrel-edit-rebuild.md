---
'@ogygia/core': patch
---

In dev, a barrel saved while a transform resolves through it is built again: the build in flight stores nothing and its callers get the new export map, instead of imports rewritten to the old files until the next edit (#200).
