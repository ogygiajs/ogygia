---
'@ogygia/core': patch
'ogygia': patch
---

A `$page.data` promise nested more than 65 levels deep, or inside a cyclic value, now streams into regions like any other: before, it was left in the seed, the page failed to serialize it, and a rejection went unhandled.
