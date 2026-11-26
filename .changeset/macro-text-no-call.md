---
"@ogygia/compiler": patch
---

A plugin macro call shown as text (a docs page writing `import.meta.og.image(path)` in prose, a code span or a fenced code sample) no longer fails with `macro_needs_plugin`, while a real call still does: in a component's `<script>` or template expression, and in a markdown page's (`.svx`, `.md`) `<script>`.
