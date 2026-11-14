---
'@ogygia/rewrite': patch
---

A matched element whose start tag a chunk boundary cuts, after a chunk with no match, is now said as split (`rewrite_element_split`, in dev) like any element its chunk ends inside, instead of going out unrendered with nothing said.
