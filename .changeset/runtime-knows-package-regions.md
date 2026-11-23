---
'@ogygia/compiler': patch
---

A region placed by a component outside `src/` (an installed package such as `@ogygia/content`'s `DocsShell`, or a workspace package) now gets the runtime features it needs: the server build names the runtime its pages load once it has compiled every module, and the client build ships exactly that runtime, also when one compiler builds both. A kept region's next-page props reach it, and the build no longer warns `runtime_marks_late` for such a component. If the client build's scan finds a feature that runtime lacks, the build stops with `runtime_features_unnamed`; a handoff that names no runtime stops it with `server_runtime_unnamed`; and a handoff the server build cannot write now stops the build instead of only warning.
