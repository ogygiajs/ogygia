---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

On SvelteKit 3, a region on a `csr = false` page that imports `$app/env/public` now hydrates and reads its dynamic public variables (`static: false`), in a build and in `vite dev`, where it threw on import before; in dev an edited variable shows on the next load.
