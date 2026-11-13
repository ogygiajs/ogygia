---
"@ogygia/compiler": patch
---

Seed shaping ships all of `page.data` when a module re-exports the page store (`export { page } from '$app/state'`, `export *`) or loads it with `import()`, so an island reading the page through such a barrel no longer reads `undefined`.
