---
'@ogygia/compiler': patch
---

Seed shaping ships all of `page.data` to an island that reads the page through `getStores()` or a parameter default (`function f(p = page)`), and no longer mistakes a shadowed helper name or a local `window` for the module's helper or the browser global; before, those reads could be left out of the page seed.
