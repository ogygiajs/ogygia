---
'@ogygia/postrender': patch
---

A successful form post's response now waits for its page's stored copy to be evicted (an outbox send, tried again within 2 s), so the redirect's GET right after renders fresh instead of getting the page from before the post (#283).
