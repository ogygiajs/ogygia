---
'@ogygia/compiler': patch
---

The server build no longer fixes its runtime features before every module is compiled when the bundler is slow to list a module's imports (under load), which could leave a region's feature out of the server's code.
