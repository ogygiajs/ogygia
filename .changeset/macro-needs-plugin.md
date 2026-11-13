---
'@ogygia/compiler': patch
---

An `import.meta.og.code`, `md`, `loader` or `regions` call in an app without `content()` listed now fails the build with `macro_needs_plugin`, naming `@ogygia/content`; before, it reached the browser or the server untouched and threw a bare TypeError there.
