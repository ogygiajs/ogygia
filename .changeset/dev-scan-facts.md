---
'@ogygia/compiler': patch
---

In dev, a wire class, a `.remote.ts` file or a router page module added or edited while the server runs takes effect without a restart: the wire loaders, Kit's codecs and the router CSS follow it (before, they kept what the server saw at start) (#1395).
