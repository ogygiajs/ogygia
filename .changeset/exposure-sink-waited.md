---
'@ogygia/flags': patch
'@ogygia/core': patch
---

An exposure sink that rejects no longer crashes the server: the failure is logged with a message code, and the request's end now keeps the sink's send alive until it ends (through the platform's `waitUntil` when it has one, otherwise by ending the response body after it), so serverless instances no longer cut exposures off (#243).
