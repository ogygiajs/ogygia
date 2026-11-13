---
'@ogygia/devtools': patch
'@ogygia/core': patch
---

An island whose hydration changed only attributes is read as the browser reads its tags: a `>` inside a quoted value no longer cuts the tag, values in any quoting with spaces around `=` and names in any case are compared, and the first of two same-name attributes is the one kept.
