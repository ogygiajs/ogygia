---
'@ogygia/core': patch
---

The server's request ports (the document tail, the page seed and late-region recorders, the context recorder, the devtools recorder, the request stats sink) are one per process, so a second copy of core in the server bundle reads what the handle installed instead of nothing.
