---
'@ogygia/core': patch
---

A navigation that was waiting on a prefetch when a remote mutation cleared the page cache fetches the page again instead of showing it as it was, a prefetch of a page a navigation is fetching joins that request, and a prefetch the clear ended gives its turn back without fetching.
