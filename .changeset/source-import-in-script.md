---
'@ogygia/compiler': patch
---

`import.meta.og.source` in a `.svelte` `<script module>` puts its runtime import inside the script (it was put in front of the whole file, as page text), and adds no line to any module, so error lines stay right.
