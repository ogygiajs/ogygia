---
'@ogygia/content': patch
---

`@ogygia/content`: a frontmatter key named `__proto__` is kept as a plain key of the parsed object, as `JSON.parse` does, and never changes the object's prototype.
