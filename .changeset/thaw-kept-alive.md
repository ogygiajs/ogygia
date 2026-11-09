---
'@ogygia/federation': patch
'@ogygia/core': patch
---

A publish's thaw notices go through an outbox handed to the request's `waitUntil` (the new `app.keepAlive`), so a serverless instance that freezes after the response no longer loses them and peers no longer keep stale pages until their TTL (#286).
