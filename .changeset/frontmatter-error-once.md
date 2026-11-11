---
'@ogygia/content': patch
---

`parseFrontmatter` reports a frontmatter block with an empty key or a tab indent as `content_frontmatter_invalid` printed once (one `[ogygia]`, one link), with the parser's words as the reason, instead of nesting a second prefix and link inside it.
