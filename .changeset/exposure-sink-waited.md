---
'@ogygia/flags': patch
'@ogygia/core': patch
---

An exposure sink that rejects no longer crashes the server: the failure is logged with a message code, and the sink's send is handed to the platform's `waitUntil` when it has one, so serverless instances no longer cut exposures off. The response never waits for the send (#243).
