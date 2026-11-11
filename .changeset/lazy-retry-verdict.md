---
'@ogygia/core': patch
---

A lazy chunk's failed retry fails its caller at once, and a use that comes before the runtime knows why it failed waits for that answer instead of failing with it (in Safari, a click right after a failed prefetch now navigates in place).
