---
"@ogygia/core": patch
---

The drop-in `setContext` now reaches islands inside a lake on a csr=true page; a csr=true page with no island ogygia wakes still ships no context.
