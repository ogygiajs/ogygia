---
'@ogygia/core': patch
---

A region snippet's slot is found by its id's exact text, with no selector built from it: an id with a quote or a bracket no longer throws or matches another slot, and its fallback marker escapes the id.
