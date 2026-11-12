---
'@ogygia/core': patch
---

`@ogygia/core`: in dev, a region's style module is imported only from the page's code origins, and a dropped download is asked for again only there, the same check an island's own code load uses (#981).
