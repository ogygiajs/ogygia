---
'@ogygia/core': patch
---

An island loaded without a `src` (a region the browser renders, a held or live region from a remote function or a stream, a hole rebuilt after a failed hydration, a portable snippet with no island graph) now loads its content-hashed file: the build writes every entry's location into one content-hashed map, named on the runtime's script, and the first such load reads it. Before, those loads fell back to the stable-name file.
