---
'@ogygia/core': minor
---

An island loaded without a `src` (a region the browser renders, a held or live region from a remote function or a stream, a hole rebuilt after a failed hydration, a portable snippet with no island graph) loads its content-hashed file: the build writes its locations into one content-hashed map, which the runtime's script names and the first such load reads.
