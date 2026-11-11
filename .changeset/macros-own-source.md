---
'@ogygia/core': minor
---

core: the `import.meta.og.*` macros, `bake` above all, work only in the app's own source and in files a package lists in `ogygia.files`; an installed file outside that list that uses one fails the build with `macro_outside_app`, and its `bake` function never runs
