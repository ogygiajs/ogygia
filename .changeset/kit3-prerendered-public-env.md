---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

On SvelteKit 3, a region on a prerendered `csr = false` page reads the deployed server's dynamic public variables (`$app/env/public`, `static: false`), as Kit's own prerendered page does, instead of the values from the build: its code waits for Kit's `_app/env.js`, and warns `kit_env_missing` if that does not load (#2212).
