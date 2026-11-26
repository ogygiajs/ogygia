---
'@ogygia/compiler': patch
---

A component's markup that shows a plugin macro call as text (a docs page writing `import.meta.og.image(path)` in prose or a code sample) no longer fails with `macro_needs_plugin`: the check reads the same `<script>` code the macros rewrite.
