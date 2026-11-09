---
'@ogygia/core': patch
---

A value the page seed cannot carry (a function, a symbol, an unknown class) is left out where it sits, so regions still get the rest of `page.data`, `form` and `error` instead of `undefined`.
