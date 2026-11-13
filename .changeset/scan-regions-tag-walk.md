---
'@ogygia/reshape': patch
---

`scanRegions` and `liftRegions` find the regions the browser reads: a comment ends at `--!>` and `<!-->` too, a region tag inside a `<noscript>`, `<textarea>` or `<title>` is text, a quote inside an unquoted value or an attribute name no longer hides the rest of the page, and the first of two same-name attributes decides a region's kind.
