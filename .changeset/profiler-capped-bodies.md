---
'@ogygia/devtools': patch
---

`@ogygia/devtools`: the profiler reads each request body up to a cap that fits its route (the login, open before sign-in: 16 KB; the beacon: 6 MB; an uploaded `.ogp` or a posted report: 32 MB) and answers 413 past it without reading the rest.
