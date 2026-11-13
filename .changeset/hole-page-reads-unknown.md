---
'@ogygia/compiler': patch
---

A deferred hole whose server tree reads the page through a `$lib` re-export of `page`, `getStores()` or `import('$app/state')` now gets `page.data`; before, it rendered with an empty one.
