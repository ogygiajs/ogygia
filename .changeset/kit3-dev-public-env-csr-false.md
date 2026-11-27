---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

On SvelteKit 3, a region on a `csr = false` page that imports `$app/env/public` now hydrates and reads its dynamic public variables (`static: false`), in a build and in `vite dev`, where it threw on import before. This holds inside a server hole and a region a remote call renders, and for an island a router prefetch loads ahead of its page.
