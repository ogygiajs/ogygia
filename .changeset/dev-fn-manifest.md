---
'@ogygia/compiler': patch
---

On the dev server, an `og.$` function that a page hands an island (through context or props) now works. Before, the dev server sent no function table with the page, so the island's call threw `... is not a function`. Builds were not affected.
