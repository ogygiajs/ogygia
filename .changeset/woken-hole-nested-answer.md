---
'@ogygia/core': patch
---

`@ogygia/core`: a server island inside a server island that wakes (`render: 'deferred', wake`, or a held region with a schedule) shows after the outer one wakes, instead of going blank. The outer hole's signed address now says it wakes (`&w=1`), and the endpoint renders its answer the way the browser hydrates it.
