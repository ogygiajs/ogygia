---
'@ogygia/machine': minor
---

New `slot({ name, version, make })`: one process-global value per name, shared by every copy of a package a process loads. The version lives only in `version` (a name carries none): another version is refused in dev and kept apart in production.
