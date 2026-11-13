---
'@ogygia/compiler': patch
---

Two modules with side effects that `export *` each other no longer hang the dev server or the build (it ran out of memory); the export walk visits each module once, as JavaScript does.
