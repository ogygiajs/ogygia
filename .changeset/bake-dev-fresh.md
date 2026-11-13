---
"@ogygia/bake": patch
---

In dev, an edit to a module a `bake` call imports bakes again with the new value, and bakes of one module at once share one run instead of racing on one temp file.
