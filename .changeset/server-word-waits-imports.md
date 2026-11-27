---
'@ogygia/compiler': patch
---

The server build no longer fixes its runtime features while the bundler has parsed a module but not yet started loading its imports, which could stop the build with `server_features_late` for a feature the server's code would have carried.
