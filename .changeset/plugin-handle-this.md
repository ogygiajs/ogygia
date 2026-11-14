---
'@ogygia/core': patch
---

A plugin's `handle`, and a `transformPageChunk` passed to `resolve()` or a plugin's `next()`, are called on their own object, so one written as a method can use `this`.
