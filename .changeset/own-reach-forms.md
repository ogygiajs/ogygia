---
'@ogygia/compiler': patch
---

A context provider or a region reached through a local barrel (`export { setContext } from 'ogygia'`, `export * from 'ogygia'`), a namespace handed on, or a dynamic `import('ogygia')` now ships the context bridge and Kit's region codec: before, islands lost that context and Kit could not decode the region (#1424).
