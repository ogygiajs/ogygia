---
'@ogygia/devtools': patch
---

The profiler's render diff and DOM diff cut markup at the tags the browser reads: a `<` or `>` inside an attribute value, a comment or a script no longer splits a tag, and single-quoted and unquoted attribute values are compared too.
