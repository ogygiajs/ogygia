---
"@ogygia/core": patch
---

A `+page.md` route counts as a page like `+page.svelte`, so a csr=false markdown page no longer makes every island page ship extra Svelte and runtime code.
