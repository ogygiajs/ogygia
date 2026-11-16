---
'@ogygia/core': patch
---

A context set with `createContext`'s setter (or ogygia's `setContext`) in a server-router page now reaches the islands on that page.
A context set with ogygia's `setContext` reaches the page's islands when the server loads ogygia's handle module twice (the Vite dev server can), not only on the first request.
