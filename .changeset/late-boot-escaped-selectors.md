---
'@ogygia/core': patch
---

A streamed page's late chunk swaps into its slot when one of its sheet hrefs or its slot id holds a quote or a backslash; before, it stayed out, or its sheet was added twice.
