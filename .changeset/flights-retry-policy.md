---
'@ogygia/machine': minor
---

`flights({ retry })` takes a `policy()` (tries, waits between them, deadline) in place of `retries`, run by the same loop as the outbox's; a wait of 0 still tries again at once (#313).
