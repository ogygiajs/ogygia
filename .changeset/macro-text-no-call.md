---
"@ogygia/compiler": patch
---

A plugin macro call shown as text (a docs page writing `import.meta.og.image(path)` in prose, a code span or a fenced code sample, wherever it sits: a list item, a block quote, any indent, a span over two lines, a markdown page's frontmatter) no longer fails with `macro_needs_plugin`, while a real call still does: in a component's `<script>` or template expression, and in a markdown page's (`.svx`, `.md`) `<script>` or markup, whatever brace its frontmatter or prose leaves open.
