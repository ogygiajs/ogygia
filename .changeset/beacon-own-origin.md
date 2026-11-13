---
'@ogygia/devtools': patch
---

The profiler's page beacon posts only to an address on the page's own origin, read from the head the server wrote: a beacon tag naming another origin, or one outside the head, sends nothing.
