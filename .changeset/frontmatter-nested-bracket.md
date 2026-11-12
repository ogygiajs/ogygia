---
'@ogygia/content': patch
---

A frontmatter list item with a `[` or `{` inside it (`title: [see [a, b]]`) is now the `content_frontmatter_invalid` error, as YAML reads it, instead of a list split in the wrong place (`['see [a', 'b']`).
