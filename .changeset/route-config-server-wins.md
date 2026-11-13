---
'@ogygia/compiler': patch
---

A route that sets a claimed `config` key in both its universal and its server module now takes the server one, as SvelteKit does at run time (`config` merges the other way from `csr`).
