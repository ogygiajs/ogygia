---
'@ogygia/core': minor
---

`import.meta.og.asRegion` is gone from the `import.meta.og` types too, so editors flag a leftover call before the build does: mark the import itself instead (`import { Header as H } from '@design/system' with { wake: 'load' }`).
