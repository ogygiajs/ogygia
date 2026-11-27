---
'@ogygia/compiler': patch
'@ogygia/core': patch
---

The key ogygia bakes into the server bundle no longer changes between builds with the same `OGYGIA_SECRET`: it is derived from the secret, not drawn at random (a build without a secret still draws a random one).
The `secret_missing_at_runtime` and `secret_conflict` messages say the server signs with the key the build derived from its secret, not a random one.
