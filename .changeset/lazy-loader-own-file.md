---
'@ogygia/core': patch
---

A lazy chunk whose download failed is asked for again in Safari too, and in Firefox a chunk whose dependency failed is no longer retried as that dependency (which ran a second copy of it and broke the wake): the build hands each lazy loader its own file.
