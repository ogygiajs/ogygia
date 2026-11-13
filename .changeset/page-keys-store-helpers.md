---
'@ogygia/compiler': patch
---

Seed shaping treats `get` and `derived` as Svelte's store helpers only when they are imported from `svelte/store` (under any name), and a `derived(page, fn)` whose callback is not written inline ships all of `page.data`. Before, a `get(page, 'data.x')` from another library or a foreign `derived` could leave keys out of the page seed.
