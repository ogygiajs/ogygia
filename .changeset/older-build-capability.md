---
'@ogygia/core': minor
---

During an upgrade from 0.12.x, an old page's deferred regions are now refused by the new server, so they keep their fallback until the visitor reloads the page. Before, the new server answered them and they hydrated wrong (the old runtime loaded the new build's island and it failed). The refusal is `x-ogygia-deny: shape` for any region URL minted before capability v3: a single request, a renewal and a batch alike.
