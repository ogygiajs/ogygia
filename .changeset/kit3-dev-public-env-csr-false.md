---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

On SvelteKit 3, a region on a `csr = false` page that imports `$app/env/public` now hydrates and reads its dynamic public variables (`static: false`), in a build and in `vite dev`, on streamed pages and on server-router pages, where it threw on import before. An island the server renders later (a `defer` hole, a remote call's region) or one a router prefetch loads ahead of its page reads an empty env and warns `kit_env_missing` instead of throwing; carrying the env there is #2219. A federated peer's region on the host's page reads an empty env and warns `kit_env_missing`, never the host app's values (#2221).
