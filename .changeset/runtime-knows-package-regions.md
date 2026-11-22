---
'@ogygia/compiler': patch
---

A region placed by a component outside `src/` (an installed package such as `@ogygia/content`'s `DocsShell`, or a workspace package) now gets the runtime features it needs: the server build names the runtime its pages load once it has compiled every module, and the client build ships exactly that runtime. A kept region's next-page props reach it, and the build no longer warns `runtime_marks_late` for such a component. If the client build ever finds a feature the server build did not name, the build stops with `runtime_features_unnamed` instead of shipping pages that load a missing runtime.
