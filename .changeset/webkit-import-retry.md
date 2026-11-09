---
'@ogygia/core': patch
---

In Safari an island file whose download failed is asked for again under a fresh URL, as in the other browsers, and its failure is reported as a failed load, not a failed hydration (#383).
