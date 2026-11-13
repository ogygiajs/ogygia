---
'@ogygia/compiler': patch
---

A route node that sets `csr` in both its universal and its server option file now takes the universal one, as SvelteKit does. Before, the server one won for page worlds, so a page Kit hydrates could be treated as client-off.
