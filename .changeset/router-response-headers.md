---
'@ogygia/router': patch
---

`c.json()` and `c.text()` keep the headers they are given as a `Headers` object or as pairs, and a `Content-Type` you pass (in any case) replaces the default instead of joining it.
