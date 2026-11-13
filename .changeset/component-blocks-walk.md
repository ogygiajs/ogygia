---
'@ogygia/compiler': patch
---

A component's script and style blocks are read the way its markup is read: a `<script>` or `<style>` inside a comment or another block's text is no longer taken as code, a `>` inside an attribute value no longer cuts the tag (flag sites were missed), `data-x="module"` no longer marks the module script, and the CSS preprocess keeps a TypeScript script's `$$props` as written (#1428).
