---
'@ogygia/core': patch
---

On a csr=false page, an island's `<svelte:head>` content stands in `<head>` where the server wrote it, whatever order the islands wake in, so two islands' head styles that set one property no longer swap winners from one load to the next.
