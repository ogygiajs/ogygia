---
'@ogygia/core': patch
---

A live region put back on the page goes on in its last tick's mode: a static one follows the writes at its address again, an interactive one hydrates its island again, instead of both stopping until the next tick (#337).
