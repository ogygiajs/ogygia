---
'@ogygia/core': patch
---

A streamed `$page.data` promise whose value throws as it is staged (a getter that throws) now fails that promise's `{#await}` instead of keeping the response open for good; the other promises still stream and the stream closes (#367).
