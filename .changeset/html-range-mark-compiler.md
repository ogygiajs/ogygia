---
'@ogygia/compiler': patch
---

Server HTML now carries a small `<!--@html-->` marker at the start of each non-empty `{@html}` that sits beside other children in an element, so the runtime can tell its content from the template's own elements.
