---
'@ogygia/federation': patch
---

A mounted peer page's head is read as a browser reads it: a title or stylesheet inside a comment is ignored, an unquoted `rel` counts, and a meta whose quoted content holds `>` is carried whole instead of cut.
