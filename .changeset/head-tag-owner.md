---
'@ogygia/core': patch
---

A client navigation that keeps a region (a refresh in place, or a link to a page with the same region) now keeps the head tags that region's inner islands wrote, such as the `ogygia-kit-island` stamp and their stylesheets; each such tag names its owning region in a `data-og-owner` attribute.
