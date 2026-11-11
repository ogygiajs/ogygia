---
'@ogygia/core': patch
'@ogygia/flags': patch
'@ogygia/postrender': patch
---

A cached hole (`maxAge`) that reads a flag, or a cookie, header or `locals` value, for an anonymous visitor is no longer kept and served to other visitors.
