---
'@ogygia/core': patch
---

A heading the router focused gives its `tabindex` back when focus leaves it, even after a second navigation focused it again meanwhile (a refresh in place at its `#hash`), or when it is kept across the navigation inside an island: it no longer stays in the tab order with `tabindex="-1"` for good (#278).
