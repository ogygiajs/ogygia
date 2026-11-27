---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

The key ogygia bakes into the server bundle no longer changes between builds with the same `OGYGIA_SECRET`: it is derived from the secret, not drawn at random (a build without a secret still draws a random one).
A deploy built with `OGYGIA_SECRET` but run without it now signs with the same key as earlier deploys built with that secret, so their pages and region links work there instead of being refused.
`secret_missing_at_runtime` says the server signs with the key the build derived from its secret, and `secret_conflict` names "this build's key" instead of "this build's random key".
