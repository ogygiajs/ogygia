---
'@ogygia/core': patch
---

Dev now says `page_payload_unreadable`, with the error, when the browser cannot read back data the server wrote for islands (the page seed, page facts, the holes record, the context marker, remote functions' data). Islands used to go on without it and nothing was said; the usual cause is a custom type the server's `transport` encodes with no decoder in the browser.
