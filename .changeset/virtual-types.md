---
'@ogygia/core': patch
---

The build serves one module per realm, `ogygia:server`, `ogygia:boot` and `ogygia:region`, with named exports, and `ogygia/types` declares them, generated from the module table so each type is read off the code that makes the value.
