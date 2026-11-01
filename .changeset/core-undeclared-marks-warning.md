---
"@ogygia/core": patch
---

The "uses ogygia marks, but its package declares no ogygia.files" warning fires only for a real marked import, not for a dependency whose comments, strings or error messages merely mention `with { wake }` (the plugin packages tripped it).
