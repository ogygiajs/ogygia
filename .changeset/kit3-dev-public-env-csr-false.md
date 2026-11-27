---
'@ogygia/compiler': patch
---

In `vite dev` on SvelteKit 3, a region on a `csr = false` page that imports `$app/env/public` now hydrates, instead of failing with "Cannot destructure property 'env' of 'globalThis.__sveltekit_dev'".
