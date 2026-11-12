---
'@ogygia/core': patch
---

`@ogygia/core`: an island's graph preload no longer adds a second `<link rel="modulepreload">` for a chunk that another loader (such as Vite's preload helper) linked after the first island started. It now checks the document's links each time it preloads.
