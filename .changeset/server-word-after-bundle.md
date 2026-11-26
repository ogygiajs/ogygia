---
'@ogygia/compiler': patch
---

The server build fixes which runtime features its code carries only once it has compiled every other module of its bundle, so a component outside the app's `src/` that it reaches while bundling (such as `@ogygia/router`'s layout chain in an app that uses `@ogygia/federation`) is counted, instead of stopping the build with `server_features_late`.
