---
'@ogygia/compiler': patch
---

The server build no longer fixes its runtime features while the bundler has parsed a module but not yet started loading its imports, which could leave a region's feature out of the server's code.
