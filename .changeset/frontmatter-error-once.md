---
'@ogygia/content': patch
---

A frontmatter block with an empty key or a tab indent now reports that error once (one `[ogygia]`, one link), the same error the markdown pipeline gives, instead of nesting it inside `content_frontmatter_invalid`.
