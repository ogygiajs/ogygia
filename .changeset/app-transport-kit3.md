---
'@ogygia/core': patch
---

On SvelteKit 3, a value of a custom `transport` type now ships in the page seed, the remote seed and a remote call's page facts; before, each dropped it, because ogygia read the transport from Kit's private request state, which Kit 3 no longer keeps it on.
