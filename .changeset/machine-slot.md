---
'@ogygia/machine': minor
---

New `slot(name, version, make)`: one process-global value per name, shared by every copy of a package a process loads, with its shape version checked (another version is refused in dev, kept apart in production).
