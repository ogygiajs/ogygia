---
'@ogygia/core': patch
---

A region whose props carry a wired class, a store or an og.$ function keeps the same `data-og-fp` from one server render to the next, so a navigation that keeps it on screen keeps it mounted with its state, and the server-delta render can skip it.
