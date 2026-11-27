---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

The key ogygia bakes into the server bundle no longer changes between builds with the same `OGYGIA_SECRET` and the same Kit `version.name`: it is derived from both, not drawn at random (a build without a secret, or whose Kit config names no version, still draws a random one).
A deploy built with `OGYGIA_SECRET` but run without it now signs with the same key as earlier such deploys of the same secret and version (built with the secret, run without it), so their pages and region links work there instead of being refused.
`secret_missing_at_runtime` says the server signs with the key the build derived from its secret, and `secret_conflict` names "this build's key" instead of "this build's random key".
