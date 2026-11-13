---
'@ogygia/rewrite': patch
---

The reversible transform's marking reads the page as the browser does: a quote inside an unquoted value or an attribute name no longer hides every custom element after it, a comment ends at `--!>` and `<!-->` too, and a custom element inside a `<noscript>` is left as the text it is.
