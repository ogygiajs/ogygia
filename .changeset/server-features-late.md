---
'@ogygia/compiler': patch
---

A build stops with `server_features_late` when a component the server build reached only while bundling (an installed package's component it does not list in `"ogygia.files"`) needs a runtime feature the server's own code was built without, naming the feature and the component, instead of rendering that region without its code.
