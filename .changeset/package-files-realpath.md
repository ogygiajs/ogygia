---
'@ogygia/core': patch
---

`ogygia.files` checks that each declared path stays inside its package by the path the file really has, so a symlink in the package that leads out of it is refused (`package_files_escapes`) or left out of a glob.
