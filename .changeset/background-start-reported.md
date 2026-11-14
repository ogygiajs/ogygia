---
'@ogygia/core': patch
---

A `wake: 'load'` island whose background start throws is reported (`machine_queue_start_failed`, then the error to the page's error handler), and the starts queued behind it still run in the same background task instead of waiting for another.
