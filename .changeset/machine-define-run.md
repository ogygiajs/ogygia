---
'@ogygia/machine': minor
---

New `defineRun(id)` and `defining()`: a plugin's definer calls owned by the run of the module that made them, so a definition deleted from the code leaves at the module's dev reload.
