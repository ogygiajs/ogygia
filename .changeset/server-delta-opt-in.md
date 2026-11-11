---
'@ogygia/core': patch
---

The server honors `x-ogygia-known` (the regions a router navigation already shows) only when the app turned on `router: { serverDelta: true }`, and a page then answers with `Vary: x-ogygia-spa, x-ogygia-known`, so a shared cache never serves a copy with regions left out to a visitor who asked for the whole page.
