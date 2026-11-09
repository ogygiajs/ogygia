---
'@ogygia/machine': minor
---

`outbox()`: work after the response, kept alive (`waitUntil`), tried again by a named retry `policy()` (attempts, backoff, jitter, deadline), joined by `id` while out, sent `inOrder` when asked, done only once the receiver applied it, and said once with a code when given up (#308).
