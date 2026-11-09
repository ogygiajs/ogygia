---
'@ogygia/flags': patch
---

Exposure batches go through an outbox: a batch the sink failed is tried again before the batch read after it, instead of being dropped, batches still reach the sink one at a time in order, and a send started by the size or age cap is kept alive past the response too (#308).
