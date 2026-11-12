---
'@ogygia/core': patch
---

`@ogygia/core`: a stylesheet that islands under two different outer islands share stays in the head after a client navigation while any of those islands is still on the page. Before, it named only the first island and could go while the second still needed it. The page's tail now lists the other owners (`<script type="application/json" data-og-owners>`), and `data-og-owner` can name several islands, space-separated.
